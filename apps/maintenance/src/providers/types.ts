import type { AnalysisReport } from "../schemas/analysis.js";
import type { Vulnerability } from "../schemas/jobRequest.js";
import type { RepoContext, RunHooks } from "@ai-auto/providers";

export type { RepoContext, RunHooks } from "@ai-auto/providers";
export { MAINT_REPORT_PATH, REPORT_DIR } from "@ai-auto/providers";

export interface MaintTask {
  jobId: string;
  vulnerabilities: Vulnerability[];
  allowMajorUpdates: boolean;
  packageManager: "npm" | "yarn" | "pnpm";
}

/**
 * Provider contract for maintenance remediation.
 * - `analyze` is read-only: recommend safe versions.
 * - `apply` edits package manifests / lockfiles toward approved candidates.
 */
export interface AgentProvider {
  readonly name: string;
  analyze(task: MaintTask, ctx: RepoContext, hooks: RunHooks): Promise<AnalysisReport>;
  apply(
    task: MaintTask,
    ctx: RepoContext,
    analysis: AnalysisReport,
    candidates: AnalysisReport["candidates"],
    hooks: RunHooks,
  ): Promise<{ summary: string }>;
}
