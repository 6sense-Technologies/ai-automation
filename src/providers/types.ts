import type { AnalysisReport } from "../schemas/analysis.js";
import type { FixOutcome } from "../schemas/fix.js";

/** The bug the agent must work on, extracted from the Jira payload. */
export interface BugTask {
  issueKey: string;
  summary: string;
  description: string;
  priority: string;
  reporter: string;
  assignee: string;
  components: string[];
  labels: string[];
  attachments: Array<{ filename: string; url: string }>;
  reproductionSteps: string;
  /** Optional reviewer remarks passed through from the approval call (Phase B only). */
  reviewerNotes?: string;
}

/** Where and how the agent runs: a local checkout prepared by the repo manager. */
export interface RepoContext {
  workdir: string;
  repoUrl: string;
  baseBranch: string;
  testCommand: string;
  /** Provider model override from config (e.g. "composer-2.5"). */
  model?: string;
}

export interface AgentEvent {
  type: "status" | "assistant" | "tool" | "thinking";
  message: string;
  timestamp: Date;
}

export interface RunHooks {
  onEvent(event: AgentEvent): void;
}

/**
 * The provider-agnostic contract every coding-agent adapter must implement.
 *
 * - `analyze` runs against a clean checkout and MUST NOT modify it (the
 *   orchestrator independently verifies and reverts any dirty state).
 * - `fix` runs on the prepared bugfix branch and edits code + tests. The
 *   orchestrator, not the adapter, runs the verification test suite, computes
 *   the diff, commits leftovers, and pushes.
 *
 * To add a provider (Claude Code, OpenCode, ...): implement this interface
 * and register a factory in registry.ts. Both methods must return reports
 * that validate against the schemas in src/schemas/.
 */
export interface AgentProvider {
  readonly name: string;
  analyze(task: BugTask, ctx: RepoContext, hooks: RunHooks): Promise<AnalysisReport>;
  fix(task: BugTask, ctx: RepoContext, approved: AnalysisReport, hooks: RunHooks): Promise<FixOutcome>;
}

/** Relative paths (inside the workdir) where adapters must have the agent write reports. */
export const REPORT_DIR = ".pipeline";
export const ANALYSIS_REPORT_PATH = `${REPORT_DIR}/analysis-report.json`;
export const FIX_REPORT_PATH = `${REPORT_DIR}/fix-report.json`;
