import { CursorAgentRunner, withTestCommand } from "@ai-auto/providers";
import { analysisReportSchema, type AnalysisReport } from "../schemas/analysis.js";
import { fixOutcomeSchema, type FixOutcome } from "../schemas/fix.js";
import { buildAnalysisPrompt, buildFixPrompt } from "./prompts.js";
import {
  ANALYSIS_REPORT_PATH,
  FIX_REPORT_PATH,
  type AgentProvider,
  type BugTask,
  type RepoContext,
  type RunHooks,
} from "./types.js";

export interface CursorProviderOptions {
  apiKey: string;
  defaultModel?: string;
}

/**
 * Default AgentProvider implementation backed by the shared Cursor agent runner.
 */
export class CursorSdkProvider implements AgentProvider {
  readonly name = "cursor";
  private readonly runner: CursorAgentRunner;

  constructor(options: CursorProviderOptions) {
    this.runner = new CursorAgentRunner(options);
  }

  async analyze(task: BugTask, ctx: RepoContext, hooks: RunHooks): Promise<AnalysisReport> {
    const prompt = buildAnalysisPrompt(task);
    return this.runner.runAndExtract(prompt, ctx, hooks, ANALYSIS_REPORT_PATH, analysisReportSchema, "analysis");
  }

  async fix(task: BugTask, ctx: RepoContext, approved: AnalysisReport, hooks: RunHooks): Promise<FixOutcome> {
    const prompt = withTestCommand(buildFixPrompt(task, approved), ctx.testCommand);
    return this.runner.runAndExtract(prompt, ctx, hooks, FIX_REPORT_PATH, fixOutcomeSchema, "fix");
  }
}
