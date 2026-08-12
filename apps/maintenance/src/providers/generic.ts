import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AnalysisReport } from "../schemas/analysis.js";
import { mergeVulnerabilities, runNpmAuditJson } from "../remediation/npmAudit.js";
import { selectVersions } from "../remediation/versions.js";
import type { AgentProvider, MaintTask, RepoContext, RunHooks } from "./types.js";

const execAsync = promisify(exec);

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

async function readPackageJson(workdir: string): Promise<PackageJson> {
  try {
    const raw = await readFile(join(workdir, "package.json"), "utf8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return {};
  }
}

function depKind(pkg: PackageJson, name: string): "prod" | "dev" | "optional" | null {
  if (pkg.dependencies?.[name]) return "prod";
  if (pkg.devDependencies?.[name]) return "dev";
  if (pkg.optionalDependencies?.[name]) return "optional";
  return null;
}

function installCommand(
  packageManager: MaintTask["packageManager"],
  specs: Array<{ packageName: string; toVersion: string; kind: ReturnType<typeof depKind> }>,
): string {
  const tokens = specs.map((s) => `${s.packageName}@${s.toVersion}`);
  if (packageManager === "yarn") {
    const dev = specs.every((s) => s.kind === "dev") ? " --dev" : "";
    return `yarn add ${tokens.join(" ")}${dev}`;
  }
  if (packageManager === "pnpm") {
    const dev = specs.every((s) => s.kind === "dev") ? " -D" : "";
    return `pnpm add ${tokens.join(" ")}${dev}`;
  }
  const dev = specs.every((s) => s.kind === "dev") ? " --save-dev" : "";
  return `npm install ${tokens.join(" ")}${dev} --no-fund --no-audit`;
}

/**
 * Deterministic remediator: npm audit + semver rules. No AI agent.
 */
export class GenericRemediator implements AgentProvider {
  readonly name = "generic";

  async analyze(task: MaintTask, ctx: RepoContext, hooks: RunHooks): Promise<AnalysisReport> {
    hooks.onEvent({ type: "status", message: "Running npm audit to collect fixable versions", timestamp: new Date() });

    const auditVulns = await runNpmAuditJson(ctx.workdir);
    const vulns = mergeVulnerabilities(task.vulnerabilities, auditVulns);
    const pkg = await readPackageJson(ctx.workdir);

    const withInstalled = vulns.map((v) => ({
      ...v,
      installedVersion:
        v.installedVersion ||
        pkg.dependencies?.[v.packageName] ||
        pkg.devDependencies?.[v.packageName] ||
        pkg.optionalDependencies?.[v.packageName],
    }));

    const selected = selectVersions(withInstalled, { allowMajorUpdates: task.allowMajorUpdates });

    if (selected.candidates.length === 0) {
      const blockers = selected.skipped.map((s) => `${s.packageName}: ${s.reason}`).join("; ") || "No patched versions found";
      return {
        schemaVersion: 1,
        status: selected.skipped.length > 0 ? "needs_manual" : "no_suitable_version",
        summary: "No safe non-breaking versions could be selected automatically.",
        vulnerabilitiesReviewed: withInstalled.length,
        candidates: [],
        fallbacks: [],
        risks: selected.skipped.map((s) => `${s.packageName}: ${s.reason}`),
        confidence: 0.2,
        blockers,
      };
    }

    hooks.onEvent({
      type: "status",
      message: `Selected ${selected.candidates.length} package update(s); skipped ${selected.skipped.length}`,
      timestamp: new Date(),
    });

    return {
      schemaVersion: 1,
      status: "ok",
      summary: `Deterministic remediation: bump ${selected.candidates
        .map((c) => `${c.packageName}@${c.toVersion}`)
        .join(", ")}`,
      vulnerabilitiesReviewed: withInstalled.length,
      candidates: selected.candidates,
      fallbacks: selected.fallbacks,
      risks: selected.skipped.map((s) => `${s.packageName}: ${s.reason}`),
      confidence: selected.skipped.length === 0 ? 0.85 : 0.6,
      blockers: "",
    };
  }

  async apply(
    task: MaintTask,
    ctx: RepoContext,
    _analysis: AnalysisReport,
    candidates: AnalysisReport["candidates"],
    hooks: RunHooks,
  ): Promise<{ summary: string }> {
    if (candidates.length === 0) return { summary: "No candidates to apply" };

    const pkg = await readPackageJson(ctx.workdir);
    const specs = candidates.map((c) => ({
      packageName: c.packageName,
      toVersion: c.toVersion,
      kind: depKind(pkg, c.packageName),
    }));

    const command = installCommand(task.packageManager, specs);
    hooks.onEvent({ type: "status", message: `Applying updates: ${command}`, timestamp: new Date() });

    try {
      await execAsync(command, { cwd: ctx.workdir, maxBuffer: 20 * 1024 * 1024 });
    } catch (err) {
      const detail = `${(err as { stdout?: string }).stdout ?? ""}\n${(err as { stderr?: string }).stderr ?? ""}\n${(err as Error).message}`;
      throw new Error(`Failed to apply dependency updates: ${detail.slice(-2000)}`);
    }

    return {
      summary: `Updated ${candidates.map((c) => `${c.packageName}@${c.toVersion}`).join(", ")}`,
    };
  }
}
