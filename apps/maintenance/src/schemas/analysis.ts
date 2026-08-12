import { z } from "zod";

export const versionCandidateSchema = z.object({
  packageName: z.string().min(1),
  fromVersion: z.string().optional(),
  toVersion: z.string().min(1),
  updateType: z.enum(["major", "minor", "patch", "unknown"]).default("unknown"),
  rationale: z.string().default(""),
});

export type VersionCandidate = z.infer<typeof versionCandidateSchema>;

export const analysisReportSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  status: z.enum(["ok", "needs_manual", "no_suitable_version"]),
  summary: z.string().default(""),
  vulnerabilitiesReviewed: z.number().int().nonnegative().default(0),
  candidates: z.array(versionCandidateSchema).default([]),
  /** Ordered fallbacks per package (orchestrator tries next on validation failure). */
  fallbacks: z.array(versionCandidateSchema).default([]),
  risks: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  blockers: z.string().default(""),
});

export type AnalysisReport = z.infer<typeof analysisReportSchema>;
