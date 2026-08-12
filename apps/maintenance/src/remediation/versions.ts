import type { Vulnerability } from "../schemas/jobRequest.js";
import type { VersionCandidate } from "../schemas/analysis.js";

export function normalizePackageName(name: string): string {
  return name.replace(/^npm-/, "").replace(/-aggregate$/, "").trim();
}

export function cleanVersion(version: string | undefined): string | undefined {
  if (!version) return undefined;
  const cleaned = version.trim().replace(/^[v^~>=<\s]+/i, "").split(/\s+/)[0];
  return cleaned || undefined;
}

export function parseSemver(version: string): [number, number, number] | null {
  const cleaned = cleanVersion(version);
  if (!cleaned) return null;
  const parts = cleaned.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

export function updateType(from: string | undefined, to: string): "major" | "minor" | "patch" | "unknown" {
  if (!from) return "unknown";
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b) return "unknown";
  if (b[0] > a[0]) return "major";
  if (b[0] === a[0] && b[1] > a[1]) return "minor";
  if (b[0] === a[0] && b[1] === a[1] && b[2] > a[2]) return "patch";
  return "unknown";
}

export function extractFixVersion(vuln: Vulnerability): string | undefined {
  if (vuln.recommendedVersion) return cleanVersion(vuln.recommendedVersion);
  const fix = vuln.fixAvailable;
  if (typeof fix === "string") {
    if (/^\d/.test(fix) || fix.startsWith("v")) return cleanVersion(fix);
    return undefined;
  }
  if (fix && typeof fix === "object") {
    const version = (fix as { version?: unknown }).version;
    if (typeof version === "string") return cleanVersion(version);
  }
  return undefined;
}

export function extractFixPackage(vuln: Vulnerability): string {
  const fix = vuln.fixAvailable;
  if (fix && typeof fix === "object") {
    const name = (fix as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return normalizePackageName(name);
  }
  return normalizePackageName(vuln.packageName);
}

export function isSemVerMajorFix(vuln: Vulnerability): boolean {
  const fix = vuln.fixAvailable;
  if (fix && typeof fix === "object" && "isSemVerMajor" in fix) {
    return Boolean((fix as { isSemVerMajor?: boolean }).isSemVerMajor);
  }
  return false;
}

export interface SelectedVersions {
  candidates: VersionCandidate[];
  fallbacks: VersionCandidate[];
  skipped: Array<{ packageName: string; reason: string }>;
}

/**
 * Deterministic safe-version picker: patch/minor first; major only when allowed.
 */
export function selectVersions(
  vulns: Vulnerability[],
  options: { allowMajorUpdates: boolean; extraFallbacks?: Record<string, string[]> } = { allowMajorUpdates: false },
): SelectedVersions {
  const byPackage = new Map<string, Vulnerability>();
  for (const vuln of vulns) {
    const pkg = extractFixPackage(vuln);
    if (!byPackage.has(pkg)) byPackage.set(pkg, vuln);
  }

  const candidates: VersionCandidate[] = [];
  const fallbacks: VersionCandidate[] = [];
  const skipped: Array<{ packageName: string; reason: string }> = [];

  for (const [packageName, vuln] of byPackage) {
    const toVersion = extractFixVersion(vuln);
    if (!toVersion) {
      skipped.push({ packageName, reason: "no patched version available from audit" });
      continue;
    }

    const fromVersion = cleanVersion(vuln.installedVersion);
    const kind = updateType(fromVersion, toVersion);
    const major = kind === "major" || isSemVerMajorFix(vuln);

    if (major && !options.allowMajorUpdates) {
      skipped.push({
        packageName,
        reason: `fix ${toVersion} is a major bump from ${fromVersion ?? "unknown"} and major updates are disabled`,
      });
      continue;
    }

    candidates.push({
      packageName,
      fromVersion,
      toVersion,
      updateType: kind,
      rationale: vuln.title
        ? `Audit fix for ${vuln.severity ?? "unknown"}: ${vuln.title}`
        : `Audit-recommended patched version ${toVersion}`,
    });

    const extras = options.extraFallbacks?.[packageName] ?? [];
    for (const extra of extras) {
      const extraKind = updateType(fromVersion ?? toVersion, extra);
      if (extraKind === "major" && !options.allowMajorUpdates) continue;
      if (compareSemver(extra, toVersion) <= 0) continue;
      fallbacks.push({
        packageName,
        fromVersion,
        toVersion: extra,
        updateType: extraKind,
        rationale: `Fallback newer compatible release ${extra}`,
      });
    }
  }

  return { candidates, fallbacks, skipped };
}
