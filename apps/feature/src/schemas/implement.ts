import { z } from "zod";

/** Agent-reported outcome at end of Phase B (orchestrator verifies independently). */
export const implementOutcomeSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  ticketId: z.string(),
  summary: z.string(),
  verification: z.string(),
  newTests: z.array(z.string()).default([]),
  deviations: z.array(z.string()).default([]),
});

export type ImplementOutcome = z.infer<typeof implementOutcomeSchema>;

export const implementReportStatusSchema = z.enum(["delivered", "tests_failed", "implement_failed"]);
export type ImplementReportStatus = z.infer<typeof implementReportStatusSchema>;

export const fileChangeSchema = z.object({
  file: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

/** Final Phase B report assembled by the orchestrator. */
export const implementReportSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  ticketId: z.string(),
  status: implementReportStatusSchema,
  branchName: z.string(),
  diffSummary: z.object({
    filesChanged: z.array(fileChangeSchema),
    commits: z.array(z.string()),
  }),
  testResults: z.object({
    command: z.string(),
    passed: z.boolean(),
    output: z.string(),
    newTests: z.array(z.string()),
  }),
  verification: z.string(),
  deviations: z.array(z.string()),
});

export type ImplementReport = z.infer<typeof implementReportSchema>;
