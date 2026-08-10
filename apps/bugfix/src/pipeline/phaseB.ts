import { PipelineError, toPipelineError } from "@ai-auto/errors";
import { runTests } from "@ai-auto/pipeline-core";
import { resolveProject } from "../config.js";
import type { AppContext } from "../context.js";
import { LABELS, renderFailureComment, renderFixComment } from "../jira/comments.js";
import type { RunHooks } from "../providers/types.js";
import type { FixReport } from "../schemas/fix.js";
import { bugfixBranchName, bugfixBranchPattern } from "./naming.js";
import { toBugTask } from "./task.js";

/**
 * Phase B: human-approved fix implementation.
 * FIXING -> TESTING -> DELIVERED (or FAILED, always reported to Jira).
 * The approval endpoint already moved the ticket AWAITING_APPROVAL -> FIXING.
 *
 * Delivery means: bugfix branch pushed to origin. Nothing is merged and no PR
 * is opened — the promotion chain (bugfix -> release -> beta -> prod -> main)
 * stays fully manual. A future PromotionService would plug in right after the
 * DELIVERED transition below.
 */
export async function runPhaseB(ctx: AppContext, issueKey: string): Promise<void> {
  const log = ctx.logger.child({ issueKey, phase: "fix" });

  log.info({ step: "phaseB.start" }, "Phase B starting");

  const ticket = await ctx.tickets.get(issueKey);
  if (!ticket || ticket.state !== "FIXING" || !ticket.analysisReport) {
    log.warn(
      { step: "phaseB.skip", state: ticket?.state },
      "phase B skipped: ticket not in FIXING with an analysis report",
    );
    return;
  }
  await ctx.audit.record(issueKey, "fix", "agent_fix_started", `approvalNotes=${ticket.approvalNotes ?? ""}`);

  const payload = ticket.jiraPayload;
  try {
    const project = resolveProject(ctx.config, issueKey, payload.components);
    const provider = ctx.providers.get(project.provider);
    log.info(
      {
        step: "phaseB.resolve_project",
        repo: project.repoUrl,
        baseBranch: project.baseBranch,
        provider: provider.name,
        model: project.model,
        testCommand: project.testCommand,
      },
      "resolved project mapping",
    );

    log.info({ step: "phaseB.clone_fetch", repo: project.repoUrl }, "ensuring local checkout (clone or fetch)");
    const workdir = await ctx.repos.ensureRepo(project.repoUrl);

    // Idempotency: resume an existing remote bugfix branch instead of duplicating.
    log.info({ step: "phaseB.find_branch" }, "looking for existing remote bugfix branch");
    const existing = await ctx.repos.findRemoteBranch(workdir, bugfixBranchPattern(issueKey));
    const branchName = existing ?? bugfixBranchName(issueKey, payload.summary);
    const resumed = await ctx.repos.checkoutFixBranch(workdir, branchName, project.baseBranch, existing);
    await ctx.audit.record(issueKey, "fix", resumed ? "branch_resumed" : "branch_created", branchName);
    log.info(
      { step: "phaseB.branch_ready", branchName, resumed, workdir },
      resumed ? "resumed existing bugfix branch" : "created new bugfix branch",
    );

    const hooks: RunHooks = {
      onEvent: (event) => {
        const level = event.type === "assistant" ? "debug" : "info";
        log[level]({ step: "phaseB.agent", event: event.type }, event.message);
        void ctx.audit.record(issueKey, "fix", `agent_${event.type}`, event.message);
      },
    };

    log.info({ step: "phaseB.agent_start", provider: provider.name }, "starting fix agent");
    const outcome = await provider.fix(
      toBugTask(payload, ticket.approvalNotes),
      {
        workdir,
        repoUrl: project.repoUrl,
        baseBranch: project.baseBranch,
        testCommand: project.testCommand,
        model: project.model,
      },
      ticket.analysisReport,
      hooks,
    );
    await ctx.audit.record(issueKey, "fix", "agent_fix_finished", outcome.summary);
    log.info({ step: "phaseB.agent_done", summary: outcome.summary }, "fix agent finished");

    // Anything the agent left uncommitted still belongs to the fix.
    const committedLeftovers = await ctx.repos.commitLeftovers(workdir, `${issueKey}: ${payload.summary}`);
    if (committedLeftovers) {
      await ctx.audit.record(issueKey, "fix", "leftover_changes_committed");
      log.info({ step: "phaseB.commit_leftovers" }, "committed leftover uncommitted changes");
    } else {
      log.info({ step: "phaseB.commit_leftovers" }, "no leftover changes to commit");
    }

    if (!(await ctx.repos.hasChangesAgainstBase(workdir, project.baseBranch))) {
      throw new PipelineError("fix_failed", "Agent finished without producing any code changes", outcome.summary);
    }
    log.info({ step: "phaseB.has_changes" }, "branch has commits beyond base");

    // Independent verification: never trust the agent's claim that tests pass.
    await ctx.tickets.transition(issueKey, "FIXING", "TESTING");
    log.info({ step: "phaseB.state", from: "FIXING", to: "TESTING" }, "state transition");
    await ctx.audit.record(issueKey, "fix", "verification_tests_started", project.testCommand);
    log.info(
      { step: "phaseB.tests_start", command: project.testCommand, timeoutMs: project.testTimeoutMs },
      "running independent verification tests",
    );
    const testResult = await runTests(project.testCommand, workdir, project.testTimeoutMs);
    await ctx.audit.record(issueKey, "fix", "verification_tests_finished", testResult.passed ? "passed" : "FAILED");
    log.info(
      { step: "phaseB.tests_done", passed: testResult.passed },
      testResult.passed ? "verification tests passed" : "verification tests FAILED",
    );

    const diffSummary = await ctx.repos.diffSummary(workdir, project.baseBranch);
    log.info(
      {
        step: "phaseB.diff",
        filesChanged: diffSummary.filesChanged.length,
        commits: diffSummary.commits.length,
      },
      "computed diff against base",
    );

    const baseReport: FixReport = {
      schemaVersion: 1,
      ticketId: issueKey,
      status: "delivered",
      branchName,
      diffSummary,
      testResults: {
        command: testResult.command,
        passed: testResult.passed,
        output: testResult.output,
        newTests: outcome.newTests,
      },
      verification: outcome.verification,
      deviations: outcome.deviations,
    };

    if (!testResult.passed) {
      // Branch stays local: a broken branch is never delivered.
      const report: FixReport = { ...baseReport, status: "tests_failed" };
      await ctx.tickets.markFailed(issueKey, "tests_failed", testResult.output.slice(-2000), { fixReport: report });
      await ctx.jira.tryAddComment(issueKey, renderFixComment(report));
      await ctx.jira.tryAddLabel(issueKey, LABELS.fixFailed);
      await ctx.audit.record(issueKey, "fix", "failed", "verification test run failed; branch not pushed");
      log.warn(
        { step: "phaseB.tests_failed", label: LABELS.fixFailed },
        "verification tests failed; branch not pushed",
      );
      return;
    }

    log.info({ step: "phaseB.push", branchName }, "pushing bugfix branch to origin");
    await ctx.repos.pushBranch(workdir, branchName);
    await ctx.audit.record(issueKey, "fix", "branch_pushed", branchName);
    log.info({ step: "phaseB.pushed", branchName }, "branch pushed");

    const delivered = await ctx.tickets.transition(issueKey, "TESTING", "DELIVERED", {
      fixReport: baseReport,
      branchName,
    });
    if (!delivered) {
      log.error({ step: "phaseB.state_error" }, "could not transition TESTING -> DELIVERED (unexpected state change)");
    } else {
      log.info({ step: "phaseB.state", from: "TESTING", to: "DELIVERED" }, "state transition");
    }

    log.info({ step: "phaseB.jira_comment" }, "posting fix report to Jira");
    await ctx.jira.tryAddComment(issueKey, renderFixComment(baseReport));
    await ctx.jira.tryAddLabel(issueKey, LABELS.fixDelivered);
    await ctx.audit.record(issueKey, "fix", "delivered", branchName);
    log.info(
      { step: "phaseB.done", branchName, label: LABELS.fixDelivered },
      "Phase B complete — bugfix branch delivered (merge stays manual)",
    );
    // Future roadmap: a PromotionService consuming DELIVERED events would
    // open PRs up the promotion chain from here. Out of scope by design.
  } catch (err) {
    const failure = toPipelineError(err);
    log.error(
      { step: "phaseB.error", reason: failure.reason, detail: failure.detail, err },
      "phase B failed",
    );
    await ctx.tickets.markFailed(issueKey, failure.reason, `${failure.message}\n${failure.detail}`.trim());
    await ctx.audit.record(issueKey, "fix", "failed", `${failure.reason}: ${failure.message}`);
    await ctx.jira.tryAddComment(
      issueKey,
      renderFailureComment(issueKey, failure.reason, `${failure.message}\n\n${failure.detail}`.trim()),
    );
    await ctx.jira.tryAddLabel(issueKey, LABELS.fixFailed);
    log.info({ step: "phaseB.failed", label: LABELS.fixFailed }, "failure reported to Jira");
  }
}
