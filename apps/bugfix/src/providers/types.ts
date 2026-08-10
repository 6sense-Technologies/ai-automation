import type { AnalysisReport } from "../schemas/analysis.js";
import type { FixOutcome } from "../schemas/fix.js";
import type { RepoContext, RunHooks } from "@ai-auto/providers";

export type { RepoContext, RunHooks } from "@ai-auto/providers";
export {
  ANALYSIS_REPORT_PATH,
  FIX_REPORT_PATH,
  REPORT_DIR,
} from "@ai-auto/providers";

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

/**
 * The provider-agnostic contract every coding-agent adapter must implement.
 *
 * - `analyze` runs against a clean checkout and MUST NOT modify it.
 * - `fix` runs on the prepared bugfix branch and edits code + tests.
 */
export interface AgentProvider {
  readonly name: string;
  analyze(task: BugTask, ctx: RepoContext, hooks: RunHooks): Promise<AnalysisReport>;
  fix(task: BugTask, ctx: RepoContext, approved: AnalysisReport, hooks: RunHooks): Promise<FixOutcome>;
}
