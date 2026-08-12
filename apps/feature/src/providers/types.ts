import type { FeaturePlan } from "../schemas/plan.js";
import type { ImplementOutcome } from "../schemas/implement.js";
import type { RepoContext, RunHooks } from "@ai-auto/providers";

export type { RepoContext, RunHooks } from "@ai-auto/providers";
export { PLAN_REPORT_PATH, FIX_REPORT_PATH as IMPLEMENT_REPORT_PATH, REPORT_DIR } from "@ai-auto/providers";

/** Enhancement/feature work extracted from the Jira payload. */
export interface FeatureTask {
  issueKey: string;
  summary: string;
  description: string;
  priority: string;
  reporter: string;
  assignee: string;
  components: string[];
  labels: string[];
  attachments: Array<{ filename: string; url: string }>;
  acceptanceCriteria: string;
  /** Optional reviewer remarks from the approval call (Phase B only). */
  reviewerNotes?: string;
}

export interface AgentProvider {
  readonly name: string;
  plan(task: FeatureTask, ctx: RepoContext, hooks: RunHooks): Promise<FeaturePlan>;
  implement(
    task: FeatureTask,
    ctx: RepoContext,
    approved: FeaturePlan,
    hooks: RunHooks,
  ): Promise<ImplementOutcome>;
}
