import { exec } from "node:child_process";
import { promisify } from "node:util";
import { toPipelineError } from "@ai-auto/errors";
import { runTests } from "@ai-auto/pipeline-core";
import type { ResolvedProject } from "../config.js";
import type { AppContext } from "../context.js";
import type { AnalysisReport, VersionCandidate } from "../schemas/analysis.js";
import type { UpdateAttempt, UpdateReport } from "../schemas/update.js";
import type { RunHooks } from "../providers/types.js";
import { parseNpmAuditVulns } from "../remediation/npmAudit.js";
import { createPullRequest } from "./createPr.js";
import { securityBranchName } from "./naming.js";

const execAsync = promisify(exec);

function defaultCommands(project: ResolvedProject) {
  const pm = project.packageManager;
  return {
    install: project.installCommand ?? (pm === "npm" ? "npm ci" : pm === "yarn" ? "yarn install --frozen-lockfile" : "pnpm install --frozen-lockfile"),
    build: project.buildCommand,
    test: project.testCommand,
    audit: project.auditCommand ?? (pm === "npm" ? "npm audit --json" : `${pm} audit --json`),
  };
}

async function loadProjectForJob(ctx: AppContext, projectKey: string, overrides: {
  repoUrl?: string;
  baseBranch?: string;
  packageManager?: "npm" | "yarn" | "pnpm";
  installCommand?: string;
  buildCommand?: string;
  testCommand?: string;
  auditCommand?: string;
  maxVersionRetries?: number;
  allowMajorUpdates?: boolean;
}): Promise<ResolvedProject> {
  const key = projectKey || "DEFAULT";
  const project = ctx.config.projects[key] ?? ctx.config.projects["DEFAULT"];
  if (!project && !overrides.repoUrl) {
    throw toPipelineError(new Error(`No project mapping for "${key}" and no repoUrl override`));
  }
  const provider =
    project?.provider && project.provider !== "cursor" ? project.provider : "generic";
  return {
    projectKey: key,
    repoUrl: overrides.repoUrl ?? project!.repo,
    baseBranch: overrides.baseBranch ?? project?.baseBranch ?? "main",
    testCommand: overrides.testCommand ?? project?.testCommand ?? "npm test",
    testTimeoutMs: project?.testTimeoutMs ?? 15 * 60 * 1000,
    provider,
    model: ctx.config.providers[provider]?.model,
    packageManager: overrides.packageManager ?? project?.packageManager ?? "npm",
    installCommand: overrides.installCommand ?? project?.installCommand,
    buildCommand: overrides.buildCommand ?? project?.buildCommand,
    auditCommand: overrides.auditCommand ?? project?.auditCommand,
    maxVersionRetries: overrides.maxVersionRetries ?? project?.maxVersionRetries ?? 3,
    allowMajorUpdates: overrides.allowMajorUpdates ?? project?.allowMajorUpdates ?? false,
  };
}

function pickCandidateSet(analysis: AnalysisReport, attemptIndex: number): VersionCandidate[] {
  if (attemptIndex === 0) return analysis.candidates;
  // Round-robin fallbacks: attempt 1 uses first fallback per package, etc.
  const byPackage = new Map<string, VersionCandidate[]>();
  for (const fb of analysis.fallbacks) {
    const list = byPackage.get(fb.packageName) ?? [];
    list.push(fb);
    byPackage.set(fb.packageName, list);
  }
  const picked: VersionCandidate[] = [];
  for (const primary of analysis.candidates) {
    const alts = byPackage.get(primary.packageName) ?? [];
    const alt = alts[attemptIndex - 1];
    picked.push(alt ?? primary);
  }
  return picked;
}

/**
 * Full remediation orchestration for one job.
 */
export async function runRemediation(ctx: AppContext, jobId: string): Promise<void> {
  const log = ctx.logger.child({ jobId, phase: "maintain" });
  log.info({ step: "orchestrator.start" }, "maintenance remediation starting");

  const job = await ctx.jobs.get(jobId);
  if (!job) {
    log.error({ step: "orchestrator.missing" }, "job not found");
    return;
  }

  const req = job.request;
  let project: ResolvedProject;
  try {
    project = await loadProjectForJob(ctx, req.projectKey, {
      repoUrl: req.repoUrl,
      baseBranch: req.baseBranch,
      packageManager: req.packageManager,
      installCommand: req.installCommand,
      buildCommand: req.buildCommand,
      testCommand: req.testCommand,
      auditCommand: req.auditCommand,
      maxVersionRetries: req.maxVersionRetries,
      allowMajorUpdates: req.allowMajorUpdates,
    });
  } catch (err) {
    const failure = toPipelineError(err);
    await ctx.jobs.markFailed(jobId, "config_error", failure.message);
    return;
  }

  const commands = defaultCommands(project);
  const provider = ctx.providers.get(project.provider);
  const hooks: RunHooks = {
    onEvent: (event) => {
      const level = event.type === "assistant" ? "debug" : "info";
      log[level]({ step: "remediator", event: event.type }, event.message);
      void ctx.audit.record(jobId, "maintain", `remediator_${event.type}`, event.message);
    },
  };

  try {
    // --- AUDIT ---
    let vulnerabilities = [...job.vulnerabilities];
    if (!req.skipAudit || vulnerabilities.length === 0) {
      const auditing = await ctx.jobs.transition(jobId, "RECEIVED", "AUDITING");
      if (!auditing) {
        log.warn({ step: "orchestrator.skip" }, "job not in RECEIVED");
        return;
      }
      await ctx.audit.record(jobId, "maintain", "audit_started");

      const workdir = await ctx.repos.ensureRepo(project.repoUrl);
      await ctx.repos.checkoutCleanBase(workdir, project.baseBranch);

      try {
        await execAsync(commands.install, { cwd: workdir, maxBuffer: 10 * 1024 * 1024 });
      } catch (err) {
        log.warn({ err }, "install before audit failed; continuing with provided vulns if any");
      }

      try {
        const { stdout } = await execAsync(commands.audit, { cwd: workdir, maxBuffer: 10 * 1024 * 1024 });
        const parsed = parseNpmAuditVulns(stdout);
        if (parsed.length > 0) vulnerabilities = parsed;
      } catch (err) {
        // npm audit exits non-zero when vulns exist; stdout may still be JSON
        const stdout = (err as { stdout?: string }).stdout ?? "";
        const parsed = parseNpmAuditVulns(stdout);
        if (parsed.length > 0) vulnerabilities = parsed;
        else if (vulnerabilities.length === 0) {
          await ctx.jobs.markFailed(jobId, "needs_manual", "npm audit failed and no vulnerabilities were provided");
          return;
        }
      }

      await ctx.jobs.transition(jobId, "AUDITING", "ANALYZING", { vulnerabilities });
      await ctx.audit.record(jobId, "maintain", "audit_finished", `count=${vulnerabilities.length}`);
    } else {
      const started = await ctx.jobs.transition(jobId, "RECEIVED", "ANALYZING");
      if (!started) {
        log.warn({ step: "orchestrator.skip" }, "job not in RECEIVED");
        return;
      }
    }

    if (vulnerabilities.length === 0) {
      await ctx.jobs.transition(jobId, ["ANALYZING", "AUDITING"], "DELIVERED", {
        updateReport: {
          schemaVersion: 1,
          status: "delivered",
          summary: "No vulnerabilities found; nothing to remediate.",
          applied: [],
          attempts: [],
        },
      });
      await ctx.audit.record(jobId, "maintain", "delivered", "no vulnerabilities");
      return;
    }

    // --- ANALYZE ---
    const workdir = await ctx.repos.ensureRepo(project.repoUrl);
    await ctx.repos.checkoutCleanBase(workdir, project.baseBranch);

    const task = {
      jobId,
      vulnerabilities,
      allowMajorUpdates: project.allowMajorUpdates,
      packageManager: project.packageManager,
    };

    log.info({ step: "analyze.start", provider: provider.name }, "starting deterministic version analysis");
    const analysis = await provider.analyze(
      task,
      {
        workdir,
        repoUrl: project.repoUrl,
        baseBranch: project.baseBranch,
        testCommand: project.testCommand,
        model: project.model,
      },
      hooks,
    );

    const dirtied = await ctx.repos.revertIfDirty(workdir);
    if (dirtied.length > 0) {
      await ctx.audit.record(jobId, "maintain", "readonly_violation_reverted", dirtied.join(", "));
    }

    if (analysis.status !== "ok" || analysis.candidates.length === 0) {
      await ctx.jobs.markFailed(
        jobId,
        analysis.status === "needs_manual" ? "needs_manual" : "no_suitable_version",
        analysis.blockers || analysis.summary || "No suitable version identified",
        { analysisReport: analysis },
      );
      await ctx.audit.record(jobId, "maintain", "needs_manual", analysis.status);
      return;
    }

    await ctx.jobs.transition(jobId, "ANALYZING", "UPDATING", { analysisReport: analysis });

    // --- UPDATE / VALIDATE / RETRY LOOP ---
    const packageHint = analysis.candidates.map((c) => c.packageName).slice(0, 3).join("-");
    const branchName = securityBranchName(jobId, packageHint);
    await ctx.repos.checkoutFixBranch(workdir, branchName, project.baseBranch, null);

    const maxAttempts = Math.max(1, project.maxVersionRetries);
    const attempts: UpdateAttempt[] = [];
    let applied: Array<{ packageName: string; version: string }> = [];
    let lastTestOutput = "";
    let lastTestCommand = project.testCommand;
    let succeeded = false;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
      if (attemptIndex > 0) {
        await ctx.jobs.transition(jobId, ["VALIDATING", "UPDATING"], "RETRYING", { attemptIndex });
        await ctx.repos.checkoutCleanBase(workdir, project.baseBranch);
        await ctx.repos.checkoutFixBranch(workdir, branchName, project.baseBranch, null);
        await ctx.jobs.transition(jobId, "RETRYING", "UPDATING");
      }

      const candidates = pickCandidateSet(analysis, attemptIndex);
      if (attemptIndex > 0 && candidates.every((c, i) => c.toVersion === analysis.candidates[i]?.toVersion)) {
        // No distinct fallbacks left
        break;
      }

      log.info({ step: "update.apply", attemptIndex, candidates }, "applying version candidates");
      await provider.apply(
        task,
        {
          workdir,
          repoUrl: project.repoUrl,
          baseBranch: project.baseBranch,
          testCommand: project.testCommand,
          model: project.model,
        },
        analysis,
        candidates,
        hooks,
      );
      await ctx.repos.commitLeftovers(workdir, `security: remediate dependencies (${jobId}) attempt ${attemptIndex + 1}`);

      await ctx.jobs.transition(jobId, "UPDATING", "VALIDATING", { attemptIndex });

      // Independent validation
      let installOk = true;
      let installOut = "";
      try {
        const r = await execAsync(commands.install, { cwd: workdir, maxBuffer: 10 * 1024 * 1024 });
        installOut = `${r.stdout}\n${r.stderr}`;
      } catch (err) {
        installOk = false;
        installOut = `${(err as { stdout?: string; stderr?: string; message?: string }).stdout ?? ""}\n${(err as { stderr?: string }).stderr ?? ""}\n${(err as Error).message}`;
      }

      let buildOk = true;
      let buildOut = "";
      if (installOk && commands.build) {
        try {
          const r = await execAsync(commands.build, { cwd: workdir, maxBuffer: 10 * 1024 * 1024 });
          buildOut = `${r.stdout}\n${r.stderr}`;
        } catch (err) {
          buildOk = false;
          buildOut = `${(err as { stdout?: string }).stdout ?? ""}\n${(err as { stderr?: string }).stderr ?? ""}`;
        }
      }

      lastTestCommand = project.testCommand;
      const testResult = installOk && buildOk
        ? await runTests(project.testCommand, workdir, project.testTimeoutMs)
        : { command: project.testCommand, passed: false, output: "skipped: install/build failed" };
      lastTestOutput = [installOut, buildOut, testResult.output].filter(Boolean).join("\n---\n");

      let auditOk = true;
      if (testResult.passed) {
        try {
          await execAsync(commands.audit.replace(" --json", ""), { cwd: workdir, maxBuffer: 5 * 1024 * 1024 });
        } catch {
          // npm audit non-zero = still has issues; treat as soft failure for remediation success
          auditOk = false;
        }
      }

      const attemptOk = installOk && buildOk && testResult.passed;
      for (const c of candidates) {
        attempts.push({
          packageName: c.packageName,
          attemptedVersion: c.toVersion,
          success: attemptOk,
          validationOutput: lastTestOutput.slice(-4000),
          error: attemptOk ? undefined : "validation failed",
        });
      }

      if (attemptOk) {
        applied = candidates.map((c) => ({ packageName: c.packageName, version: c.toVersion }));
        succeeded = true;
        await ctx.audit.record(jobId, "maintain", "validation_passed", `attempt=${attemptIndex} auditCleared=${auditOk}`);
        break;
      }

      await ctx.audit.record(jobId, "maintain", "validation_failed", `attempt=${attemptIndex}`);
      // Revert working tree to stable base for next attempt
      await ctx.repos.checkoutCleanBase(workdir, project.baseBranch);
    }

    if (!succeeded) {
      const report: UpdateReport = {
        schemaVersion: 1,
        status: "needs_manual",
        branchName,
        applied: [],
        attempts,
        testResults: { command: lastTestCommand, passed: false, output: lastTestOutput.slice(-4000) },
        summary: "No suitable version passed validation; reverted to previous stable base.",
      };
      await ctx.jobs.markFailed(jobId, "needs_manual", report.summary, { updateReport: report, branchName });
      await ctx.audit.record(jobId, "maintain", "needs_manual", "retries exhausted");
      return;
    }

    // --- PR ---
    await ctx.jobs.transition(jobId, "VALIDATING", "PR_READY", { branchName, attemptIndex: attempts.length });
    await ctx.repos.pushBranch(workdir, branchName);

    let prUrl: string | undefined;
    if (req.createPullRequest !== false) {
      prUrl = await createPullRequest({
        workdir,
        title: `security: remediate vulnerable dependencies (${jobId})`,
        body: [
          "## Dependency remediation",
          "",
          analysis.summary,
          "",
          "### Applied versions",
          ...applied.map((a) => `- \`${a.packageName}\` → \`${a.version}\``),
          "",
          "### Validation",
          `- Install / build / test: passed`,
          "",
          `_Automated by the maintenance remediator (no AI agent)_`,
        ].join("\n"),
        head: branchName,
        base: project.baseBranch,
        githubToken: ctx.env.GITHUB_TOKEN,
      });
    }

    const report: UpdateReport = {
      schemaVersion: 1,
      status: "delivered",
      branchName,
      prUrl,
      applied,
      attempts,
      testResults: { command: lastTestCommand, passed: true, output: lastTestOutput.slice(-2000) },
      summary: prUrl ? `Remediation delivered: ${prUrl}` : `Branch pushed: ${branchName}`,
    };

    await ctx.jobs.transition(jobId, "PR_READY", "DELIVERED", {
      updateReport: report,
      branchName,
      prUrl,
    });
    await ctx.audit.record(jobId, "maintain", "delivered", prUrl ?? branchName);
    log.info({ step: "orchestrator.done", prUrl, branchName }, "maintenance remediation delivered");
  } catch (err) {
    const failure = toPipelineError(err);
    log.error({ step: "orchestrator.error", err, reason: failure.reason }, "remediation failed");
    await ctx.jobs.markFailed(jobId, failure.reason, `${failure.message}\n${failure.detail}`.trim());
    await ctx.audit.record(jobId, "maintain", "failed", `${failure.reason}: ${failure.message}`);
  }
}
