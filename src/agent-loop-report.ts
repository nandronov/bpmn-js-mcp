/**
 * Markdown report generation for agent-loop audit output.
 * Extracted to keep agent-loop-cli.ts within the max-lines ESLint limit.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { ScenarioScore } from './eval/types';
import type { AuditLog, IterationAudit, TokenUsage, ToolCallEntry } from './agent-loop-types';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function gradeEmoji(grade: string): string {
  const map: Record<string, string> = { A: '🟢', B: '🟡', C: '🟠', D: '🔴', F: '💀' };
  return map[grade?.toUpperCase()] ?? '⬜';
}

function svgInline(svgAbsPath: string, maxWidthPx: number): string {
  if (!fs.existsSync(svgAbsPath)) return '';
  let svg = fs.readFileSync(svgAbsPath, 'utf-8');
  svg = svg.replace(
    /^(<svg\b)/m,
    `$1 style="max-width:${maxWidthPx}px;height:auto;border:1px solid #ccc;border-radius:4px;"`
  );
  return svg;
}

function scenarioTableRow(s: ScenarioScore): string {
  return (
    `| ${s.scenarioId} | ${s.name} | ${gradeEmoji(s.grade)} ${s.grade} | ${s.score.toFixed(2)}` +
    ` | ${s.metrics.overlaps} | ${s.metrics.crossings} | ${s.metrics.diagonalSegments}` +
    ` | ${s.metrics.bendCount} | ${s.metrics.detourRatioAvg.toFixed(2)} | ${s.metrics.gridSnapAvg.toFixed(2)} |`
  );
}

function scenarioTable(scenarios: ScenarioScore[]): string {
  return [
    '| ID | Scenario | Grade | Score | Overlaps | Crossings | Diags | Bends | Detour | GridSnap |',
    '|:--|:--|:--:|--:|--:|--:|--:|--:|--:|--:|',
    ...scenarios.map(scenarioTableRow),
  ].join('\n');
}

function tokenTable(usage: TokenUsage): string {
  const total = ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)).toLocaleString();
  return [
    '| Metric | Value |',
    '|:--|--:|',
    `| Input tokens | ${usage.inputTokens ?? '—'} |`,
    `| Output tokens | ${usage.outputTokens ?? '—'} |`,
    `| Cache read tokens | ${usage.cacheReadTokens ?? '—'} |`,
    `| Cache write tokens | ${usage.cacheWriteTokens ?? '—'} |`,
    `| **Total** | **${total}** |`,
  ].join('\n');
}

function toolCallSection(toolCalls: ToolCallEntry[]): string {
  if (toolCalls.length === 0) return '_No tool calls recorded (transcript unavailable)._';
  const bpmnTools = toolCalls.filter((t) => t.tool.includes('bpmn'));
  const otherTools = toolCalls.filter((t) => !t.tool.includes('bpmn'));
  const lines: string[] = [];
  if (bpmnTools.length > 0) {
    lines.push('**BPMN MCP tool calls:**');
    for (const tc of bpmnTools) lines.push(`- \`${tc.tool}\``);
  }
  if (otherTools.length > 0) {
    lines.push('\n**Other tool calls:**');
    for (const tc of otherTools) lines.push(`- \`${tc.tool}\``);
  }
  return lines.join('\n');
}

function diffSection(patchAbsPath: string): string {
  if (!patchAbsPath || !fs.existsSync(patchAbsPath)) return '_No patch recorded._';
  const lines = fs.readFileSync(patchAbsPath, 'utf-8').split('\n');
  const truncated = lines.length > 80;
  const shown = lines.slice(0, 80).join('\n');
  return ['```diff', shown, truncated ? `... (truncated, ${lines.length - 80} more lines)` : '', '```'].join('\n'); // prettier-ignore
}

function svgComparisonTable(
  beforeSvgs: string[],
  afterSvgs: string[],
  scenarios: ScenarioScore[]
): string {
  if (beforeSvgs.length === 0 && afterSvgs.length === 0) return '';
  const rows: string[] = ['| Scenario | Before | After |', '|:--|:--|:--|'];
  for (const s of scenarios) {
    const before = beforeSvgs.find((p) => path.basename(p).includes(s.scenarioId));
    const after = afterSvgs.find((p) => path.basename(p).includes(s.scenarioId));
    rows.push(`| **${s.scenarioId}** ${s.name} | ${before ? svgInline(before, 300) : '—'} | ${after ? svgInline(after, 300) : '—'} |`); // prettier-ignore
  }
  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function reportHeader(audit: AuditLog): string[] {
  const sections: string[] = [
    '# Agent-Loop Audit Report',
    '',
    '| | |',
    '|:--|:--|',
    `| **Started** | ${audit.startedAt} |`,
    `| **Finished** | ${audit.finishedAt} |`,
    `| **Repo** | \`${audit.repoDir}\` |`,
    `| **Git commit** | \`${audit.gitCommit}\` |`,
    `| **Iterations run** | ${audit.iterations.length} |`,
  ];
  if (audit.baselineReport && audit.finalReport) {
    const delta = audit.finalReport.aggregate.scoreAvg - audit.baselineReport.aggregate.scoreAvg;
    sections.push(`| **Score delta** | ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} |`);
  }
  sections.push('', '## Executive Summary', '');
  const accepted = audit.iterations.filter((i) => i.accepted).length;
  sections.push(`- **${accepted}** of **${audit.iterations.length}** iterations accepted.`);
  for (const iter of audit.iterations) {
    const icon = iter.accepted ? '✅' : '❌';
    const delta = iter.scoreImprovement;
    const reason = iter.rejectionReason ? ` (${iter.rejectionReason})` : '';
    sections.push(`- ${icon} **Iter ${iter.iter}**: model=\`${iter.model}\` Δscore=${delta >= 0 ? '+' : ''}${delta.toFixed(3)} accepted=${iter.accepted}${reason}`); // prettier-ignore
  }
  sections.push('');
  return sections;
}

function reportBaselineSection(audit: AuditLog, journalDir: string): string[] {
  if (!audit.baselineReport) return [];
  const r = audit.baselineReport;
  const sections: string[] = [
    '## Baseline Evaluation',
    '',
    `**Avg score:** ${r.aggregate.scoreAvg.toFixed(3)} | **Min:** ${r.aggregate.scoreMin.toFixed(3)}`,
    '',
    scenarioTable(r.scenarios),
    '',
  ];
  const svgDir = path.join(journalDir, 'iter-00', 'svgs-baseline');
  if (fs.existsSync(svgDir)) {
    const svgs = fs.readdirSync(svgDir).map((f) => path.join(svgDir, f));
    if (svgs.length > 0) {
      sections.push(
        '### Baseline Diagrams',
        '',
        '<div style="display:flex;flex-wrap:wrap;gap:10px;">'
      );
      for (const svg of svgs) sections.push(svgInline(svg, 400));
      sections.push('</div>', '');
    }
  }
  return sections;
}

function iterSvgSection(iter: IterationAudit, iterDir: string, journalDir: string): string[] {
  const beforeSvgDir = path.join(iterDir, 'svgs-baseline');
  const afterSvgDir = path.join(iterDir, 'svgs-after');
  const beforeSvgs = fs.existsSync(beforeSvgDir) ? fs.readdirSync(beforeSvgDir).map((f) => path.join(beforeSvgDir, f)) : []; // prettier-ignore
  const afterSvgs = fs.existsSync(afterSvgDir) ? fs.readdirSync(afterSvgDir).map((f) => path.join(afterSvgDir, f)) : []; // prettier-ignore
  if (beforeSvgs.length === 0 && afterSvgs.length === 0) return [];
  const baseScenarios = iter.baselineReport?.scenarios ?? iter.candidateReport?.scenarios ?? [];
  return ['#### Diagram Before / After', '', svgComparisonTable(beforeSvgs, afterSvgs, baseScenarios), '']; // prettier-ignore
  void journalDir;
}

function reportIterationSection(iter: IterationAudit, journalDir: string): string[] {
  const label = `iter-${String(iter.iter).padStart(2, '0')}`;
  const iterDir = path.join(journalDir, label);
  const sections: string[] = [
    `### ${iter.accepted ? '✅' : '❌'} Iteration ${iter.iter}`,
    '',
    `| | |\n|:--|:--|\n| **Started** | ${iter.startedAt} |\n| **Finished** | ${iter.finishedAt} |\n| **Duration** | ${iter.durationSec.toFixed(1)}s |\n| **Model** | \`${iter.model}\` |\n| **Score improvement** | ${iter.scoreImprovement >= 0 ? '+' : ''}${iter.scoreImprovement.toFixed(3)} |\n| **Accepted** | ${iter.accepted ? 'Yes' : 'No'} |`, // prettier-ignore
    '',
  ];
  if (iter.tokenUsage.inputTokens || iter.tokenUsage.outputTokens) {
    sections.push('#### Token Usage', '', tokenTable(iter.tokenUsage), '');
  }
  if (iter.toolCalls.length > 0) {
    sections.push('#### MCP Tool Calls', '', toolCallSection(iter.toolCalls), '');
  }
  if (iter.baselineReport && iter.candidateReport) {
    sections.push('#### Score Comparison', '', '**Before:**', '', scenarioTable(iter.baselineReport.scenarios), '', '**After:**', '', scenarioTable(iter.candidateReport.scenarios), ''); // prettier-ignore
  }
  sections.push(...iterSvgSection(iter, iterDir, journalDir));
  if (iter.patchPath) {
    sections.push('#### Code Changes', '', diffSection(iter.patchPath), '');
  }
  if (iter.sessionTranscriptPath && fs.existsSync(iter.sessionTranscriptPath)) {
    const excerpt = fs
      .readFileSync(iter.sessionTranscriptPath, 'utf-8')
      .split('\n')
      .slice(0, 60)
      .join('\n');
    sections.push('<details>', '<summary>Session Transcript (first 60 lines)</summary>', '', excerpt, '', '</details>', ''); // prettier-ignore
  }
  return sections;
}

function reportFinalSection(audit: AuditLog, journalDir: string): string[] {
  if (!audit.finalReport) return [];
  const r = audit.finalReport;
  const sections: string[] = [
    '## Final Evaluation',
    '',
    `**Avg score:** ${r.aggregate.scoreAvg.toFixed(3)} | **Min:** ${r.aggregate.scoreMin.toFixed(3)}`,
    '',
    scenarioTable(r.scenarios),
    '',
  ];
  const svgDir = path.join(journalDir, 'final-svgs');
  if (fs.existsSync(svgDir)) {
    const svgs = fs.readdirSync(svgDir).map((f) => path.join(svgDir, f));
    if (svgs.length > 0) {
      sections.push(
        '### Final Diagrams',
        '',
        '<div style="display:flex;flex-wrap:wrap;gap:10px;">'
      );
      for (const svg of svgs) sections.push(svgInline(svg, 400));
      sections.push('</div>', '');
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateMarkdownReport(audit: AuditLog, journalDir: string): string {
  return [
    ...reportHeader(audit),
    ...reportBaselineSection(audit, journalDir),
    '## Iterations',
    '',
    ...audit.iterations.flatMap((iter) => reportIterationSection(iter, journalDir)),
    ...reportFinalSection(audit, journalDir),
    '## Appendix: Raw Reports',
    '',
    '<details>',
    '<summary>Baseline Report JSON</summary>',
    '',
    '```json',
    JSON.stringify(audit.baselineReport, null, 2),
    '```',
    '',
    '</details>',
    '',
    '<details>',
    '<summary>Final Report JSON</summary>',
    '',
    '```json',
    JSON.stringify(audit.finalReport, null, 2),
    '```',
    '',
    '</details>',
  ].join('\n');
}
