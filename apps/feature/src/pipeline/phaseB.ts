import { PipelineError, toPipelineError } from "@ai-auto/errors";
import { runTests } from "@ai-auto/pipeline-core";
import { resolveProject } from "../config.js";
import type { AppContext } from "../context.js";
import { LABELS, renderFailureComment, renderImplementComment } from "../jira/comments.js";
import type { RunHooks } from "../providers/types.js";
import type { ImplementReport } from "../schemas/implement.js";
import { featureBranchName, featureBranchPattern } from "./naming.js";
import { toFeatureTask } from "./task.js";

export async function runPhaseB(ctx: AppContext, issueKey: string): Promise<void> {
  const log = ctx.logger.child({ issueKey, phase: "implement" });

  log.info({ step: "phaseB.start" }, "Phase B (implement) starting");

  const ticket = await ctx.tickets.get(issueKey);
  if (!ticket || ticket.state !== "IMPLEMENTING" || !ticket.featurePlan) {
    log.warn(
      { step: "phaseB.skip", state: ticket?.state },
      "phase B skipped: ticket not in IMPLEMENTING with a feature plan",
    );
    return;
  }
  await ctx.audit.record(issueKey, "implement", "agent_implement_started", `approvalNotes=${ticket.approvalNotes ?? ""}`);

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

    log.info({ step: "phaseB.clone_fetch", repo: project.repoUrl }, "ensuring local checkout");
    const workdir = await ctx.repos.ensureRepo(project.repoUrl);

    log.info({ step: "phaseB.find_branch" }, "looking for existing remote feature branch");
    const existing = await ctx.repos.findRemoteBranch(workdir, featureBranchPattern(issueKey));
    const branch = existing ?? featureBranchName(issueKey, payload.summary);
    const resumed = await ctx.repos.checkoutFixBranch(workdir, branch, project.baseBranch, existing);
    await ctx.audit.record(issueKey, "implement", resumed ? "branch_resumed" : "branch_created", branch);
    log.info(
      { step: "phaseB.branch_ready", branchName: branch, resumed, workdir },
      resumed ? "resumed existing feature branch" : "created new feature branch",
    );

    const hooks: RunHooks = {
      onEvent: (event) => {
        const level = event.type === "assistant" ? "debug" : "info";
        log[level]({ step: "phaseB.agent", event: event.type }, event.message);
        void ctx.audit.record(issueKey, "implement", `agent_${event.type}`, event.message);
      },
    };

    log.info({ step: "phaseB.agent_start", provider: provider.name }, "starting implement agent");
    const outcome = await provider.implement(
      toFeatureTask(payload, ticket.approvalNotes),
      {
        workdir,
        repoUrl: project.repoUrl,
        baseBranch: project.baseBranch,
        testCommand: project.testCommand,
        model: project.model,
      },
      ticket.featurePlan,
      hooks,
    );
    await ctx.audit.record(issueKey, "implement", "agent_implement_finished", outcome.summary);
    log.info({ step: "phaseB.agent_done", summary: outcome.summary }, "implement agent finished");

    const committedLeftovers = await ctx.repos.commitLeftovers(workdir, `${issueKey}: ${payload.summary}`);
    if (committedLeftovers) {
      await ctx.audit.record(issueKey, "implement", "leftover_changes_committed");
      log.info({ step: "phaseB.commit_leftovers" }, "committed leftover uncommitted changes");
    } else {
      log.info({ step: "phaseB.commit_leftovers" }, "no leftover changes to commit");
    }

    if (!(await ctx.repos.hasChangesAgainstBase(workdir, project.baseBranch))) {
      throw new PipelineError("fix_failed", "Agent finished without producing any code changes", outcome.summary);
    }
    log.info({ step: "phaseB.has_changes" }, "branch has commits beyond base");

    await ctx.tickets.transition(issueKey, "IMPLEMENTING", "TESTING");
    log.info({ step: "phaseB.state", from: "IMPLEMENTING", to: "TESTING" }, "state transition");
    await ctx.audit.record(issueKey, "implement", "verification_tests_started", project.testCommand);
    log.info(
      { step: "phaseB.tests_start", command: project.testCommand, timeoutMs: project.testTimeoutMs },
      "running independent verification tests",
    );
    const testResult = await runTests(project.testCommand, workdir, project.testTimeoutMs);
    await ctx.audit.record(issueKey, "implement", "verification_tests_finished", testResult.passed ? "passed" : "FAILED");
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

    const baseReport: ImplementReport = {
      schemaVersion: 1,
      ticketId: issueKey,
      status: "delivered",
      branchName: branch,
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
      const report: ImplementReport = { ...baseReport, status: "tests_failed" };
      await ctx.tickets.markFailed(issueKey, "tests_failed", testResult.output.slice(-2000), {
        implementReport: report,
      });
      await ctx.jira.tryAddComment(issueKey, renderImplementComment(report));
      await ctx.jira.tryAddLabel(issueKey, LABELS.failed);
      await ctx.audit.record(issueKey, "implement", "failed", "verification test run failed; branch not pushed");
      log.warn({ step: "phaseB.tests_failed", label: LABELS.failed }, "verification tests failed; branch not pushed");
      return;
    }

    log.info({ step: "phaseB.push", branchName: branch }, "pushing feature branch to origin");
    await ctx.repos.pushBranch(workdir, branch);
    await ctx.audit.record(issueKey, "implement", "branch_pushed", branch);
    log.info({ step: "phaseB.pushed", branchName: branch }, "branch pushed");

    const delivered = await ctx.tickets.transition(issueKey, "TESTING", "DELIVERED", {
      implementReport: baseReport,
      branchName: branch,
    });
    if (!delivered) {
      log.error({ step: "phaseB.state_error" }, "could not transition TESTING -> DELIVERED");
    } else {
      log.info({ step: "phaseB.state", from: "TESTING", to: "DELIVERED" }, "state transition");
    }

    log.info({ step: "phaseB.jira_comment" }, "posting implement report to Jira");
    await ctx.jira.tryAddComment(issueKey, renderImplementComment(baseReport));
    await ctx.jira.tryAddLabel(issueKey, LABELS.delivered);
    await ctx.audit.record(issueKey, "implement", "delivered", branch);
    log.info(
      { step: "phaseB.done", branchName: branch, label: LABELS.delivered },
      "Phase B complete — feature branch delivered",
    );
  } catch (err) {
    const failure = toPipelineError(err);
    log.error({ step: "phaseB.error", reason: failure.reason, detail: failure.detail, err }, "phase B failed");
    await ctx.tickets.markFailed(issueKey, failure.reason, `${failure.message}\n${failure.detail}`.trim());
    await ctx.audit.record(issueKey, "implement", "failed", `${failure.reason}: ${failure.message}`);
    await ctx.jira.tryAddComment(
      issueKey,
      renderFailureComment(issueKey, failure.reason, `${failure.message}\n\n${failure.detail}`.trim()),
    );
    await ctx.jira.tryAddLabel(issueKey, LABELS.failed);
    log.info({ step: "phaseB.failed", label: LABELS.failed }, "failure reported to Jira");
  }
}
