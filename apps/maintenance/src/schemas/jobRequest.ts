import { z } from "zod";

export const vulnerabilitySchema = z.object({
  packageName: z.string().min(1),
  installedVersion: z.string().optional(),
  severity: z.enum(["Low", "Moderate", "High", "Critical", "low", "moderate", "high", "critical", "info"]).optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  isDirect: z.boolean().optional(),
  fixAvailable: z.union([z.boolean(), z.string(), z.record(z.string(), z.unknown())]).optional(),
  range: z.string().optional(),
  /** Preferred patched version when already known (e.g. from npm audit). */
  recommendedVersion: z.string().optional(),
});

export type Vulnerability = z.infer<typeof vulnerabilitySchema>;

export const createJobBodySchema = z.object({
  /** TeamPulse repository ObjectId (optional but recommended for status correlation). */
  repositoryId: z.string().optional(),
  /** Logical project key from pipeline.config.yaml (default: DEFAULT). */
  projectKey: z.string().default("DEFAULT"),
  /** Override repo URL from config when TeamPulse already knows the clone URL. */
  repoUrl: z.string().optional(),
  baseBranch: z.string().optional(),
  packageManager: z.enum(["npm", "yarn", "pnpm"]).optional(),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  testCommand: z.string().optional(),
  auditCommand: z.string().optional(),
  maxVersionRetries: z.number().int().positive().optional(),
  allowMajorUpdates: z.boolean().optional(),
  /** Pre-identified vulns from TeamPulse Security / npm audit. If empty, pipeline runs audit locally. */
  vulnerabilities: z.array(vulnerabilitySchema).default([]),
  /** Optional linked Jira key for status comments. */
  issueKey: z.string().optional(),
  /** Skip local npm audit when TeamPulse already refreshed scan data. */
  skipAudit: z.boolean().default(false),
  /** Open a PR automatically after green validation (default true). */
  createPullRequest: z.boolean().default(true),
});

export type CreateJobBody = z.infer<typeof createJobBodySchema>;
