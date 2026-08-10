import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Agent, CursorAgentError, type SDKAgent, type SDKMessage } from "@cursor/sdk";
import type { ZodType } from "zod";
import { AgentRunError, AgentStartupError, ReportValidationError } from "@ai-auto/errors";
import type { RepoContext, RunHooks } from "./types.js";

export interface CursorRunnerOptions {
  apiKey: string;
  defaultModel?: string;
}

const DEFAULT_MODEL = "composer-2.5";

/**
 * Shared Cursor SDK local-agent runner. Services supply their own prompts and
 * Zod schemas; structured output is read from a report file the agent writes.
 */
export class CursorAgentRunner {
  constructor(private readonly options: CursorRunnerOptions) {}

  async runAndExtract<T>(
    prompt: string,
    ctx: RepoContext,
    hooks: RunHooks,
    reportRelPath: string,
    schema: ZodType<T>,
    phase: string,
  ): Promise<T> {
    const reportPath = join(ctx.workdir, reportRelPath);
    // A stale report from a previous attempt must never be mistaken for fresh output.
    await rm(reportPath, { force: true });

    await this.runAgent(prompt, ctx, hooks);

    let raw: string;
    try {
      raw = await readFile(reportPath, "utf8");
    } catch {
      throw new ReportValidationError(
        `Agent finished the ${phase} run but did not write the required report file`,
        reportRelPath,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ReportValidationError(`Agent ${phase} report is not valid JSON`, (err as Error).message);
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ReportValidationError(`Agent ${phase} report failed schema validation`, issues);
    }
    return result.data;
  }

  async runAgent(prompt: string, ctx: RepoContext, hooks: RunHooks): Promise<void> {
    let agent: SDKAgent;
    try {
      agent = await Agent.create({
        apiKey: this.options.apiKey,
        model: { id: ctx.model ?? this.options.defaultModel ?? DEFAULT_MODEL },
        local: { cwd: ctx.workdir },
      });
    } catch (err) {
      if (err instanceof CursorAgentError) {
        throw new AgentStartupError(`Cursor agent failed to start: ${err.message}`, "", err.isRetryable === true);
      }
      throw err;
    }

    try {
      const run = await agent.send(prompt);
      hooks.onEvent({
        type: "status",
        message: `cursor run started (agentId=${agent.agentId}, runId=${run.id})`,
        timestamp: new Date(),
      });

      for await (const message of run.stream()) {
        const event = summarizeMessage(message);
        if (event) hooks.onEvent({ ...event, timestamp: new Date() });
      }

      const result = await run.wait();
      if (result.status === "error") {
        throw new AgentRunError(
          `Cursor run ${result.id} failed: ${result.error?.message ?? "unknown error"}`,
          result.error?.code ?? "",
        );
      }
      if (result.status === "cancelled") {
        throw new AgentRunError(`Cursor run ${result.id} was cancelled`);
      }
    } catch (err) {
      if (err instanceof CursorAgentError) {
        throw new AgentStartupError(`Cursor agent request failed: ${err.message}`, "", err.isRetryable === true);
      }
      throw err;
    } finally {
      await agent[Symbol.asyncDispose]();
    }
  }
}

function summarizeMessage(message: SDKMessage): { type: "assistant" | "tool" | "thinking" | "status"; message: string } | null {
  switch (message.type) {
    case "assistant": {
      const text = message.message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
      return text.trim() ? { type: "assistant", message: truncate(text, 500) } : null;
    }
    case "tool_call":
      // Emitted for both start and completion; report completions only to halve the noise.
      if (message.status === "running") return null;
      return { type: "tool", message: `${message.name} (${message.status})` };
    case "status":
      return { type: "status", message: `${message.status}${message.message ? `: ${message.message}` : ""}` };
    default:
      return null;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
