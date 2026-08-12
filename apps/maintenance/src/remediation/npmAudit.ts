import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Vulnerability } from "../schemas/jobRequest.js";

const execAsync = promisify(exec);

interface NpmAuditVulnerability {
  name?: string;
  severity?: string;
  isDirect?: boolean;
  fixAvailable?: boolean | string | Record<string, unknown>;
  range?: string;
  via?: unknown;
}

export function parseNpmAuditVulns(auditJson: string): Vulnerability[] {
  try {
    const data = JSON.parse(auditJson) as {
      vulnerabilities?: Record<string, NpmAuditVulnerability>;
    };
    const vulns: Vulnerability[] = [];
    for (const [name, info] of Object.entries(data.vulnerabilities ?? {})) {
      const via = Array.isArray(info.via)
        ? info.via.find((v) => typeof v === "object" && v && "title" in v)
        : undefined;
      const title =
        via && typeof via === "object" && via && "title" in via
          ? String((via as { title: string }).title)
          : undefined;
      const url =
        via && typeof via === "object" && via && "url" in via
          ? String((via as { url: string }).url)
          : undefined;
      const fix = info.fixAvailable;
      const recommendedVersion =
        fix && typeof fix === "object" && typeof (fix as { version?: unknown }).version === "string"
          ? String((fix as { version: string }).version)
          : undefined;

      vulns.push({
        packageName: info.name ?? name,
        severity: (info.severity as Vulnerability["severity"]) ?? "moderate",
        title,
        url,
        isDirect: info.isDirect,
        fixAvailable: info.fixAvailable,
        range: info.range,
        recommendedVersion,
      });
    }
    return vulns;
  } catch {
    return [];
  }
}

export async function runNpmAuditJson(workdir: string, command = "npm audit --json"): Promise<Vulnerability[]> {
  try {
    const { stdout } = await execAsync(command, { cwd: workdir, maxBuffer: 20 * 1024 * 1024 });
    return parseNpmAuditVulns(stdout);
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout ?? "";
    return parseNpmAuditVulns(stdout);
  }
}

export function mergeVulnerabilities(primary: Vulnerability[], extra: Vulnerability[]): Vulnerability[] {
  const byName = new Map<string, Vulnerability>();
  for (const vuln of [...extra, ...primary]) {
    const key = vuln.packageName;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, vuln);
      continue;
    }
    byName.set(key, {
      ...existing,
      ...vuln,
      recommendedVersion: vuln.recommendedVersion || existing.recommendedVersion,
      fixAvailable: vuln.fixAvailable ?? existing.fixAvailable,
      installedVersion: vuln.installedVersion || existing.installedVersion,
    });
  }
  return [...byName.values()];
}
