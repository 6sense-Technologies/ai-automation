import { toPipelineError } from "@ai-auto/errors";
import { resolveProject } from "../config.js";
import type { AppContext } from "../context.js";
import { LABELS, renderAnalysisComment, renderFailureComment } from "../jira/comments.js";
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

  log.info({ step: "phaseA.start" }, "Phase A starting");

  const started = await ctx.tickets.transition(issueKey, "RECEIVED", "ANALYZING");
  if (!started) {
    log.warn({ step: "phaseA.skip" }, "phase A skipped: ticket is not in RECEIVED (duplicate trigger or lost race)");
    return;
  }
  log.info({ step: "phaseA.state", from: "RECEIVED", to: "ANALYZING" }, "state transition");
  await ctx.audit.record(issueKey, "analyze", "agent_analysis_started");

  try {
    const project = resolveProject(ctx.config, issueKey, payload.components);
    const provider = ctx.providers.get(project.provider);
    log.info(
      {
        step: "phaseA.resolve_project",
        repo: project.repoUrl,
        baseBranch: project.baseBranch,
        provider: provider.name,
        model: project.model,
      },
      "resolved project mapping",
    );

    log.info({ step: "phaseA.clone_fetch", repo: project.repoUrl }, "ensuring local checkout (clone or fetch)");
    const workdir = await ctx.repos.ensureRepo(project.repoUrl);
    log.info({ step: "phaseA.checkout_base", workdir, baseBranch: project.baseBranch }, "checking out clean base branch");
    await ctx.repos.checkoutCleanBase(workdir, project.baseBranch);

    const hooks: RunHooks = {
      onEvent: (event) => {
        const level = event.type === "assistant" ? "debug" : "info";
        log[level]({ step: "phaseA.agent", event: event.type }, event.message);
        void ctx.audit.record(issueKey, "analyze", `agent_${event.type}`, event.message);
      },
    };

    log.info({ step: "phaseA.agent_start", provider: provider.name }, "starting read-only analysis agent");
    const report = await provider.analyze(toBugTask(payload), {
      workdir,
      repoUrl: project.repoUrl,
      baseBranch: project.baseBranch,
      testCommand: project.testCommand,
      model: project.model,
    }, hooks);
    log.info(
      { step: "phaseA.agent_done", status: report.status, confidence: report.confidence },
      "analysis agent finished",
    );

    // Read-only guard: the analysis phase must not leave the checkout dirty.
    const dirtied = await ctx.repos.revertIfDirty(workdir);
    if (dirtied.length > 0) {
      log.warn({ step: "phaseA.readonly_violation", dirtied }, "analysis agent modified files; changes were reverted");
      await ctx.audit.record(issueKey, "analyze", "readonly_violation_reverted", dirtied.join(", "));
    } else {
      log.info({ step: "phaseA.readonly_ok" }, "checkout still clean after analysis");
    }

    await ctx.audit.record(issueKey, "analyze", "report_generated", `status=${report.status} confidence=${report.confidence}`);

    if (report.status !== "ok") {
      // Honest dead-end: post the partial report, mark FAILED so a re-trigger can retry.
      log.warn({ step: "phaseA.blocked", status: report.status, blockers: report.blockers }, "analysis did not reach a root cause");
      await ctx.jira.tryAddComment(issueKey, renderAnalysisComment(report));
      await ctx.jira.tryAddLabel(issueKey, LABELS.fixFailed);
      await ctx.tickets.markFailed(issueKey, report.status, report.blockers);
      await ctx.audit.record(issueKey, "analyze", "analysis_blocked", report.status);
      log.info({ step: "phaseA.failed", label: LABELS.fixFailed }, "marked FAILED and reported to Jira");
      return;
    }

    const paused = await ctx.tickets.transition(issueKey, "ANALYZING", "AWAITING_APPROVAL", {
      analysisReport: report,
    });
    if (!paused) {
      log.error({ step: "phaseA.state_error" }, "could not transition ANALYZING -> AWAITING_APPROVAL (unexpected state change)");
      return;
    }
    log.info({ step: "phaseA.state", from: "ANALYZING", to: "AWAITING_APPROVAL" }, "state transition");

    log.info({ step: "phaseA.jira_comment" }, "posting analysis comment to Jira");
    await ctx.jira.tryAddComment(issueKey, renderAnalysisComment(report));
    await ctx.jira.tryAddLabel(issueKey, LABELS.analysisReady);
    await ctx.audit.record(issueKey, "analyze", "awaiting_approval", "report posted to Jira");
    log.info(
      { step: "phaseA.done", label: LABELS.analysisReady },
      "Phase A complete — waiting for human approval (POST /api/tickets/:key/approve)",
    );
  } catch (err) {
    const failure = toPipelineError(err);
    log.error(
      { step: "phaseA.error", reason: failure.reason, detail: failure.detail, err },
      "phase A failed",
    );
    await ctx.tickets.markFailed(issueKey, failure.reason, `${failure.message}\n${failure.detail}`.trim());
    await ctx.audit.record(issueKey, "analyze", "failed", `${failure.reason}: ${failure.message}`);
    await ctx.jira.tryAddComment(
      issueKey,
      renderFailureComment(issueKey, failure.reason, `${failure.message}\n\n${failure.detail}`.trim()),
    );
    await ctx.jira.tryAddLabel(issueKey, LABELS.fixFailed);
    log.info({ step: "phaseA.failed", label: LABELS.fixFailed }, "failure reported to Jira");
  }
}
