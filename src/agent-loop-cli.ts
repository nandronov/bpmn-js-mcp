import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { runEval } from './eval/run-eval';
import type { EvalConfig, EvalReport } from './eval/types';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function run(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  const res = spawnSync(cmd, args, {
    cwd: opts?.cwd ?? process.cwd(),
    env: { ...process.env, ...(opts?.env ?? {}) },
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  if (res.status !== 0) {
    const err = new Error(
      `Command failed: ${cmd} ${args.join(' ')}\nexit=${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`
    );
    (err as any).stdout = res.stdout;
    (err as any).stderr = res.stderr;
    throw err;
  }
  return { stdout: res.stdout as string, stderr: res.stderr as string };
}

function requireCleanGitTree() {
  // Only consider tracked diffs. Untracked files (e.g. test outputs) are fine.
  const trackedDirty =
    spawnSync('git', ['diff', '--quiet'], { encoding: 'utf-8', stdio: 'ignore' }).status !== 0 ||
    spawnSync('git', ['diff', '--cached', '--quiet'], { encoding: 'utf-8', stdio: 'ignore' })
      .status !== 0;
  if (trackedDirty) {
    throw new Error('Refusing to run agent-loop: tracked files have diffs (git diff not clean).');
  }
}

function hardRevert() {
  run('git', ['reset', '--hard', 'HEAD']);
  run('git', ['clean', '-fd']);
}



function validateDiffPaths(diff: string) {
  const allowedPrefixes = [
    'src/',
    'test/',
    'docs/',
    'README.md',
    'TODO.md',
    'Makefile',
    'package.json',
    'esbuild.config.mjs',
    'tsconfig.json',
    'tsconfig.test.json',
    'vitest.config.ts',
    'eslint.config.mjs',
  ];

  const forbiddenPrefixes = ['dist/', 'node_modules/', '.git/'];

  const fileLines = diff
    .split(/\r?\n/)
    .filter((l) => l.startsWith('+++ b/') || l.startsWith('--- a/'));

  const paths = new Set<string>();
  for (const l of fileLines) {
    const p = l
      .replace(/^\+\+\+ b\//, '')
      .replace(/^--- a\//, '')
      .trim();
    if (p === '/dev/null') continue;
    paths.add(p);
  }

  for (const p of paths) {
    if (forbiddenPrefixes.some((fx) => p.startsWith(fx))) {
      throw new Error(`Diff touches forbidden path: ${p}`);
    }
    if (!allowedPrefixes.some((fx) => p === fx || p.startsWith(fx))) {
      throw new Error(`Diff touches disallowed path: ${p}`);
    }
  }
}

function summarizeReport(report: EvalReport): string {
  const worst = [...report.scenarios].sort((a, b) => a.score - b.score)[0];
  return [
    `Aggregate: avg=${report.aggregate.scoreAvg} min=${report.aggregate.scoreMin}`,
    `Worst: ${worst.scenarioId} ${worst.name} score=${worst.score} grade=${worst.grade}`,
    `Worst metrics: overlaps=${worst.metrics.overlaps}, crossings=${worst.metrics.crossings}, diagonalSegments=${worst.metrics.diagonalSegments}, bendCount=${worst.metrics.bendCount}, detourRatioAvg=${worst.metrics.detourRatioAvg}, nearMisses=${worst.metrics.nearMisses}, gridSnapAvg=${worst.metrics.gridSnapAvg}`,
  ].join('\n');
}

/**
 * Ask Copilot to directly edit files in the working tree (using its write tools),
 * then return the unified diff of what it changed (via `git diff HEAD`).
 *
 * This avoids the "hallucinated context lines" problem of asking an LLM to
 * produce a raw diff: the model reads the real file, edits it in place, and
 * the resulting git diff is always a valid, applicable patch.
 */
function copilotRunEdits(prompt: string, repoDir: string): string {
  const args = [
    '-p',
    prompt,
    '-s',
    '--no-ask-user',
    '--allow-all-tools',
    '--deny-tool',
    'shell', // no arbitrary shell execution
    '--disable-builtin-mcps',
    '--add-dir',
    repoDir,
    '--stream',
    'off',
  ];

  // Run copilot; it edits files directly via write tools.
  // Inherit stdio so progress/thinking is visible to the user.
  spawnSync('copilot', args, {
    cwd: repoDir,
    env: { ...process.env },
    stdio: 'inherit',
  });

  // Capture the real diff of what Copilot changed.
  const res = spawnSync('git', ['diff', 'HEAD'], {
    cwd: repoDir,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  return (res.stdout ?? '').trim();
}

function buildPrompt(report: EvalReport): string {
  const worst = [...report.scenarios].sort((a, b) => a.score - b.score)[0];
  return [
    'You are improving an open-source TypeScript project that lays out BPMN diagrams headlessly.',
    'Your task: make targeted edits to the TypeScript source files to improve the layout quality score.',
    '',
    'Hard constraints:',
    '- Edit ONLY files under src/ or test/ (not dist/, node_modules/, or generated artifacts).',
    '- Do not change the scoring weights in src/eval/score.ts.',
    '- Keep changes minimal and focused on the layout engine in src/rebuild/.',
    '- Do not add new npm packages.',
    '',
    'Context: current eval report summary:',
    summarizeReport(report),
    '',
    `Focus on improving the worst scenario: ${worst.scenarioId} ${worst.name}.`,
    'Typical fix areas: routing waypoints, overlap avoidance, and layout spacing in src/rebuild/.',
  ].join('\n');
}

interface IterCtx {
  iter: number;
  iterations: number;
  repoDir: string;
  journalDir: string;
  evalConfig: EvalConfig;
  minImprove: number;
}

async function runIteration(
  ctx: IterCtx,
  baseline: EvalReport
): Promise<{ next: EvalReport; ok: boolean }> {
  const { iter, iterations, repoDir, journalDir, evalConfig, minImprove } = ctx;
  const worst = [...baseline.scenarios].sort((a, b) => a.score - b.score)[0];

  process.stdout.write(`\nIteration ${iter}/${iterations}: asking Copilot to edit files...\n`);
  const diff = copilotRunEdits(buildPrompt(baseline), repoDir);

  if (!diff) {
    process.stdout.write(`Iteration ${iter}: Copilot made no changes. Stopping.\n`);
    return { next: baseline, ok: false };
  }

  const label = `iter-${String(iter).padStart(2, '0')}`;
  const patchPath = path.join(journalDir, `${label}.patch`);

  let ok = false;
  let next = baseline;
  try {
    validateDiffPaths(diff);
    fs.writeFileSync(patchPath, diff + '\n', 'utf-8');

    run('npm', ['run', 'build'], { cwd: repoDir });
    run('npm', ['test'], { cwd: repoDir });
    const candidate = await runEval(evalConfig);
    fs.writeFileSync(
      path.join(journalDir, `${label}.report.json`),
      JSON.stringify(candidate, null, 2) + '\n',
      'utf-8'
    );

    const improve = candidate.aggregate.scoreAvg - baseline.aggregate.scoreAvg;
    if (improve >= minImprove) {
      run('git', ['add', '-A'], { cwd: repoDir });
      run('git', ['commit', '--no-verify', '-m', `agent-loop: iter-${iter} avg +${improve.toFixed(2)} (${worst.scenarioId})`], { cwd: repoDir }); // prettier-ignore
      process.stdout.write(`Iteration ${iter}: accepted (avg +${improve.toFixed(2)}) patch=${path.relative(repoDir, patchPath)}\n`); // prettier-ignore
      next = candidate;
      ok = true;
    } else {
      process.stdout.write(`Iteration ${iter}: rejected (avg +${improve.toFixed(2)} < ${minImprove}) patch=${path.relative(repoDir, patchPath)}\n`); // prettier-ignore
    }
  } catch (err) {
    process.stderr.write(`Iteration ${iter}: failed: ${(err as Error).message}\n`);
  } finally {
    if (!ok) hardRevert();
  }
  return { next, ok };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const repoDir = path.resolve(String(args.repoDir ?? process.cwd()));
  const outputDir = path.resolve(String(args.outputDir ?? 'test-outputs/eval'));
  const journalDir = path.join(outputDir, 'agent-loop');
  const iterations = args.iterations ? Number(args.iterations) : 3;
  const minImprove = args.minImprove ? Number(args.minImprove) : 0.1;

  if (!Number.isFinite(iterations) || iterations <= 0) throw new Error('--iterations must be > 0');

  fs.mkdirSync(journalDir, { recursive: true });
  process.chdir(repoDir);
  requireCleanGitTree();

  const evalConfig: EvalConfig = { outputDir, exportArtifacts: true };
  let baseline = await runEval(evalConfig);
  fs.writeFileSync(path.join(outputDir, 'report.baseline.json'), JSON.stringify(baseline, null, 2) + '\n', 'utf-8'); // prettier-ignore
  process.stdout.write('Baseline\n' + summarizeReport(baseline) + '\n');

  for (let iter = 1; iter <= iterations; iter++) {
    const { next, ok } = await runIteration(
      { iter, iterations, repoDir, journalDir, evalConfig, minImprove },
      baseline
    );
    baseline = next;
    if (!ok && !next) break; // Copilot made no changes — stop early
  }

  fs.writeFileSync(path.join(outputDir, 'report.final.json'), JSON.stringify(baseline, null, 2) + '\n', 'utf-8'); // prettier-ignore
  process.stdout.write('Final\n' + summarizeReport(baseline) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
