import { toPipelineError } from "@ai-auto/errors";
import { resolveProject } from "../config.js";
import type { AppContext } from "../context.js";
import { LABELS, renderFailureComment, renderPlanComment } from "../jira/comments.js";
import type { RunHooks } from "../providers/types.js";
import type { JiraWebhookPayload } from "../schemas/webhook.js";
import { toFeatureTask } from "./task.js";

export async function runPhaseA(ctx: AppContext, payload: JiraWebhookPayload): Promise<void> {
  const { issueKey } = payload;
  const log = ctx.logger.child({ issueKey, phase: "plan" });

  log.info({ step: "phaseA.start" }, "Phase A (plan) starting");

  const started = await ctx.tickets.transition(issueKey, "RECEIVED", "PLANNING");
  if (!started) {
    log.warn({ step: "phaseA.skip" }, "phase A skipped: ticket is not in RECEIVED");
    return;
  }
  log.info({ step: "phaseA.state", from: "RECEIVED", to: "PLANNING" }, "state transition");
  await ctx.audit.record(issueKey, "plan", "agent_plan_started");

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

    log.info({ step: "phaseA.clone_fetch", repo: project.repoUrl }, "ensuring local checkout");
    const workdir = await ctx.repos.ensureRepo(project.repoUrl);
    log.info({ step: "phaseA.checkout_base", workdir, baseBranch: project.baseBranch }, "checking out clean base");
    await ctx.repos.checkoutCleanBase(workdir, project.baseBranch);

    const hooks: RunHooks = {
      onEvent: (event) => {
        const level = event.type === "assistant" ? "debug" : "info";
        log[level]({ step: "phaseA.agent", event: event.type }, event.message);
        void ctx.audit.record(issueKey, "plan", `agent_${event.type}`, event.message);
      },
    };

    log.info({ step: "phaseA.agent_start", provider: provider.name }, "starting read-only planning agent");
    const report = await provider.plan(toFeatureTask(payload), {
      workdir,
      repoUrl: project.repoUrl,
      baseBranch: project.baseBranch,
      testCommand: project.testCommand,
      model: project.model,
    }, hooks);
    log.info(
      { step: "phaseA.agent_done", status: report.status, confidence: report.confidence },
      "planning agent finished",
    );

    const dirtied = await ctx.repos.revertIfDirty(workdir);
    if (dirtied.length > 0) {
      log.warn({ step: "phaseA.readonly_violation", dirtied }, "plan agent modified files; reverted");
      await ctx.audit.record(issueKey, "plan", "readonly_violation_reverted", dirtied.join(", "));
    } else {
      log.info({ step: "phaseA.readonly_ok" }, "checkout still clean after planning");
    }

    await ctx.audit.record(issueKey, "plan", "report_generated", `status=${report.status} confidence=${report.confidence}`);

    if (report.status !== "ok") {
      log.warn({ step: "phaseA.blocked", status: report.status, blockers: report.blockers }, "could not produce a plan");
      await ctx.jira.tryAddComment(issueKey, renderPlanComment(report));
      await ctx.jira.tryAddLabel(issueKey, LABELS.failed);
      const reason = report.status === "needs_more_info" ? "needs_more_info" : "cannot_find_root_cause";
      await ctx.tickets.markFailed(issueKey, reason, report.blockers);
      await ctx.audit.record(issueKey, "plan", "plan_blocked", report.status);
      log.info({ step: "phaseA.failed", label: LABELS.failed }, "marked FAILED and reported to Jira");
      return;
    }

    const paused = await ctx.tickets.transition(issueKey, "PLANNING", "AWAITING_APPROVAL", {
      featurePlan: report,
    });
    if (!paused) {
      log.error({ step: "phaseA.state_error" }, "could not transition PLANNING -> AWAITING_APPROVAL");
      return;
    }
    log.info({ step: "phaseA.state", from: "PLANNING", to: "AWAITING_APPROVAL" }, "state transition");

    log.info({ step: "phaseA.jira_comment" }, "posting plan comment to Jira");
    await ctx.jira.tryAddComment(issueKey, renderPlanComment(report));
    await ctx.jira.tryAddLabel(issueKey, LABELS.planReady);
    await ctx.audit.record(issueKey, "plan", "awaiting_approval", "plan posted to Jira");
    log.info(
      { step: "phaseA.done", label: LABELS.planReady },
      "Phase A complete — waiting for human approval",
    );
  } catch (err) {
    const failure = toPipelineError(err);
    log.error({ step: "phaseA.error", reason: failure.reason, detail: failure.detail, err }, "phase A failed");
    await ctx.tickets.markFailed(issueKey, failure.reason, `${failure.message}\n${failure.detail}`.trim());
    await ctx.audit.record(issueKey, "plan", "failed", `${failure.reason}: ${failure.message}`);
    await ctx.jira.tryAddComment(
      issueKey,
      renderFailureComment(issueKey, failure.reason, `${failure.message}\n\n${failure.detail}`.trim()),
    );
    await ctx.jira.tryAddLabel(issueKey, LABELS.failed);
    log.info({ step: "phaseA.failed", label: LABELS.failed }, "failure reported to Jira");
  }
}
