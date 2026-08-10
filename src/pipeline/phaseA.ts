import { resolveProject } from "../config.js";
import type { AppContext } from "../context.js";
import { toPipelineError } from "../errors.js";
import { LABELS, renderAnalysisComment, renderFailureComment } from "../jira/client.js";
import type { RunHooks } from "../providers/types.js";
import type { JiraWebhookPayload } from "../schemas/webhook.js";
import { toBugTask } from "./task.js";

/**
 * Phase A: automatic, read-only analysis.
 * RECEIVED -> ANALYZING -> AWAITING_APPROVAL (or FAILED, always reported to Jira).
 */
export async function runPhaseA(ctx: AppContext, payload: JiraWebhookPayload): Promise<void> {
  const { issueKey } = payload;
  const log = ctx.logger.child({ issueKey, phase: "analyze" });

  const started = await ctx.tickets.transition(issueKey, "RECEIVED", "ANALYZING");
  if (!started) {
    log.warn("phase A skipped: ticket is not in RECEIVED (duplicate trigger or lost race)");
    return;
  }
  await ctx.audit.record(issueKey, "analyze", "agent_analysis_started");

  try {
    const project = resolveProject(ctx.config, issueKey, payload.components);
    const provider = ctx.providers.get(project.provider);
    log.info({ repo: project.repoUrl, provider: provider.name }, "preparing checkout for analysis");

    const workdir = await ctx.repos.ensureRepo(project.repoUrl);
    await ctx.repos.checkoutCleanBase(workdir, project.baseBranch);

    const hooks: RunHooks = {
      onEvent: (event) => {
        log.debug({ event: event.type }, event.message);
        void ctx.audit.record(issueKey, "analyze", `agent_${event.type}`, event.message);
      },
    };

    const report = await provider.analyze(toBugTask(payload), {
      workdir,
      repoUrl: project.repoUrl,
      baseBranch: project.baseBranch,
      testCommand: project.testCommand,
      model: project.model,
    }, hooks);

    // Read-only guard: the analysis phase must not leave the checkout dirty.
    const dirtied = await ctx.repos.revertIfDirty(workdir);
    if (dirtied.length > 0) {
      log.warn({ dirtied }, "analysis agent modified files; changes were reverted");
      await ctx.audit.record(issueKey, "analyze", "readonly_violation_reverted", dirtied.join(", "));
    }

    await ctx.audit.record(issueKey, "analyze", "report_generated", `status=${report.status} confidence=${report.confidence}`);

    if (report.status !== "ok") {
      // Honest dead-end: post the partial report, mark FAILED so a re-trigger can retry.
      await ctx.jira.tryAddComment(issueKey, renderAnalysisComment(report));
      await ctx.jira.tryAddLabel(issueKey, LABELS.fixFailed);
      await ctx.tickets.markFailed(issueKey, report.status, report.blockers);
      await ctx.audit.record(issueKey, "analyze", "analysis_blocked", report.status);
      log.warn({ status: report.status }, "analysis did not reach a root cause");
      return;
    }

    const paused = await ctx.tickets.transition(issueKey, "ANALYZING", "AWAITING_APPROVAL", {
      analysisReport: report,
    });
    if (!paused) {
      log.error("could not transition ANALYZING -> AWAITING_APPROVAL (unexpected state change)");
      return;
    }

    await ctx.jira.tryAddComment(issueKey, renderAnalysisComment(report));
    await ctx.jira.tryAddLabel(issueKey, LABELS.analysisReady);
    await ctx.audit.record(issueKey, "analyze", "awaiting_approval", "report posted to Jira");
    log.info("analysis posted; pipeline paused for human approval");
  } catch (err) {
    const failure = toPipelineError(err);
    log.error({ reason: failure.reason, detail: failure.detail, err }, "phase A failed");
    await ctx.tickets.markFailed(issueKey, failure.reason, `${failure.message}\n${failure.detail}`.trim());
    await ctx.audit.record(issueKey, "analyze", "failed", `${failure.reason}: ${failure.message}`);
    await ctx.jira.tryAddComment(
      issueKey,
      renderFailureComment(issueKey, failure.reason, `${failure.message}\n\n${failure.detail}`.trim()),
    );
    await ctx.jira.tryAddLabel(issueKey, LABELS.fixFailed);
  }
}
