/**
 * Shared audit data-structure types for agent-loop.
 * Extracted so both agent-loop-cli.ts and agent-loop-report.ts can import them.
 */
import type { EvalReport } from './eval/types';

export interface ToolCallEntry {
  tool: string;
  argsSummary: string;
  resultSummary: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface IterationAudit {
  iter: number;
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  model: string;
  tokenUsage: TokenUsage;
  svgSnapshots: { baseline: string[]; after: string[] };
  sessionTranscriptPath: string;
  toolCalls: ToolCallEntry[];
  patchPath: string;
  changedFiles: string[];
  scoreImprovement: number;
  accepted: boolean;
  rejectionReason: string;
  baselineReport: EvalReport | null;
  candidateReport: EvalReport | null;
}

export interface AuditLog {
  startedAt: string;
  finishedAt: string;
  repoDir: string;
  gitCommit: string;
  iterations: IterationAudit[];
  baselineReport: EvalReport | null;
  finalReport: EvalReport | null;
}
