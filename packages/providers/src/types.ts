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

/** Relative paths (inside the workdir) where adapters must have the agent write reports. */
export const REPORT_DIR = ".pipeline";
export const ANALYSIS_REPORT_PATH = `${REPORT_DIR}/analysis-report.json`;
export const FIX_REPORT_PATH = `${REPORT_DIR}/fix-report.json`;
export const PLAN_REPORT_PATH = `${REPORT_DIR}/plan-report.json`;
export const MAINT_REPORT_PATH = `${REPORT_DIR}/maint-report.json`;

export function withTestCommand(prompt: string, testCommand: string): string {
  return prompt.replace("__TEST_COMMAND__", testCommand);
}
