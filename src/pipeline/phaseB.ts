import { resolveProject } from "../config.js";
import type { AppContext } from "../context.js";
import { PipelineError, toPipelineError } from "../errors.js";
import { LABELS, renderFailureComment, renderFixComment } from "../jira/client.js";
import type { RunHooks } from "../providers/types.js";
import type { FixReport } from "../schemas/fix.js";
import { bugfixBranchName, bugfixBranchPattern } from "./naming.js";
import { toBugTask } from "./task.js";
import { runTests } from "./testRunner.js";

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

  const ticket = await ctx.tickets.get(issueKey);
  if (!ticket || ticket.state !== "FIXING" || !ticket.analysisReport) {
    log.warn({ state: ticket?.state }, "phase B skipped: ticket not in FIXING with an analysis report");
    return;
  }
  await ctx.audit.record(issueKey, "fix", "agent_fix_started", `approvalNotes=${ticket.approvalNotes ?? ""}`);

  const payload = ticket.jiraPayload;
  try {
    const project = resolveProject(ctx.config, issueKey, payload.components);
    const provider = ctx.providers.get(project.provider);
    const workdir = await ctx.repos.ensureRepo(project.repoUrl);

    // Idempotency: resume an existing remote bugfix branch instead of duplicating.
    const existing = await ctx.repos.findRemoteBranch(workdir, bugfixBranchPattern(issueKey));
    const branchName = existing ?? bugfixBranchName(issueKey, payload.summary);
    const resumed = await ctx.repos.checkoutFixBranch(workdir, branchName, project.baseBranch, existing);
    await ctx.audit.record(issueKey, "fix", resumed ? "branch_resumed" : "branch_created", branchName);
    log.info({ branchName, resumed }, "bugfix branch ready");

    const hooks: RunHooks = {
      onEvent: (event) => {
        log.debug({ event: event.type }, event.message);
        void ctx.audit.record(issueKey, "fix", `agent_${event.type}`, event.message);
      },
    };

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

    // Anything the agent left uncommitted still belongs to the fix.
    const committedLeftovers = await ctx.repos.commitLeftovers(workdir, `${issueKey}: ${payload.summary}`);
    if (committedLeftovers) {
      await ctx.audit.record(issueKey, "fix", "leftover_changes_committed");
    }

    if (!(await ctx.repos.hasChangesAgainstBase(workdir, project.baseBranch))) {
      throw new PipelineError("fix_failed", "Agent finished without producing any code changes", outcome.summary);
    }

    // Independent verification: never trust the agent's claim that tests pass.
    await ctx.tickets.transition(issueKey, "FIXING", "TESTING");
    await ctx.audit.record(issueKey, "fix", "verification_tests_started", project.testCommand);
    const testResult = await runTests(project.testCommand, workdir, project.testTimeoutMs);
    await ctx.audit.record(issueKey, "fix", "verification_tests_finished", testResult.passed ? "passed" : "FAILED");

    const diffSummary = await ctx.repos.diffSummary(workdir, project.baseBranch);
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
      log.warn("verification tests failed; branch not pushed");
      return;
    }

    await ctx.repos.pushBranch(workdir, branchName);
    await ctx.audit.record(issueKey, "fix", "branch_pushed", branchName);

    const delivered = await ctx.tickets.transition(issueKey, "TESTING", "DELIVERED", {
      fixReport: baseReport,
      branchName,
    });
    if (!delivered) {
      log.error("could not transition TESTING -> DELIVERED (unexpected state change)");
    }

    await ctx.jira.tryAddComment(issueKey, renderFixComment(baseReport));
    await ctx.jira.tryAddLabel(issueKey, LABELS.fixDelivered);
    await ctx.audit.record(issueKey, "fix", "delivered", branchName);
    log.info({ branchName }, "fix delivered");
    // Future roadmap: a PromotionService consuming DELIVERED events would
    // open PRs up the promotion chain from here. Out of scope by design.
  } catch (err) {
    const failure = toPipelineError(err);
    log.error({ reason: failure.reason, detail: failure.detail, err }, "phase B failed");
    await ctx.tickets.markFailed(issueKey, failure.reason, `${failure.message}\n${failure.detail}`.trim());
    await ctx.audit.record(issueKey, "fix", "failed", `${failure.reason}: ${failure.message}`);
    await ctx.jira.tryAddComment(
      issueKey,
      renderFailureComment(issueKey, failure.reason, `${failure.message}\n\n${failure.detail}`.trim()),
    );
    await ctx.jira.tryAddLabel(issueKey, LABELS.fixFailed);
  }
}
