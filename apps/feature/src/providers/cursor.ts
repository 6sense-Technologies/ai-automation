import { CursorAgentRunner, withTestCommand } from "@ai-auto/providers";
import { featurePlanSchema, type FeaturePlan } from "../schemas/plan.js";
import { implementOutcomeSchema, type ImplementOutcome } from "../schemas/implement.js";
import { buildImplementPrompt, buildPlanPrompt } from "./prompts.js";
import {
  IMPLEMENT_REPORT_PATH,
  PLAN_REPORT_PATH,
  type AgentProvider,
  type FeatureTask,
  type RepoContext,
  type RunHooks,
} from "./types.js";

export interface CursorProviderOptions {
  apiKey: string;
  defaultModel?: string;
}

export class CursorSdkProvider implements AgentProvider {
  readonly name = "cursor";
  private readonly runner: CursorAgentRunner;

  constructor(options: CursorProviderOptions) {
    this.runner = new CursorAgentRunner(options);
  }

  async plan(task: FeatureTask, ctx: RepoContext, hooks: RunHooks): Promise<FeaturePlan> {
    const prompt = buildPlanPrompt(task);
    return this.runner.runAndExtract(prompt, ctx, hooks, PLAN_REPORT_PATH, featurePlanSchema, "plan");
  }

  async implement(
    task: FeatureTask,
    ctx: RepoContext,
    approved: FeaturePlan,
    hooks: RunHooks,
  ): Promise<ImplementOutcome> {
    const prompt = withTestCommand(buildImplementPrompt(task, approved), ctx.testCommand);
    return this.runner.runAndExtract(
      prompt,
      ctx,
      hooks,
      IMPLEMENT_REPORT_PATH,
      implementOutcomeSchema,
      "implement",
    );
  }
}
