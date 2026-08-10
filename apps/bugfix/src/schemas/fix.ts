import { z } from "zod";

/**
 * What the agent itself reports at the end of Phase B. The orchestrator does
 * not trust these fields for anything load-bearing: diff summary and test
 * results are computed independently and merged into the final FixReport.
 */
export const fixOutcomeSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  ticketId: z.string(),
  summary: z.string(),
  verification: z.string(),
  newTests: z.array(z.string()).default([]),
  deviations: z.array(z.string()).default([]),
});

export type FixOutcome = z.infer<typeof fixOutcomeSchema>;

export const fixReportStatusSchema = z.enum(["delivered", "tests_failed", "fix_failed"]);
export type FixReportStatus = z.infer<typeof fixReportStatusSchema>;

export const fileChangeSchema = z.object({
  file: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

/**
 * Final Phase B report, assembled by the orchestrator (agent outcome + real
 * git diff + real test run), stored in Mongo and posted to Jira.
 */
export const fixReportSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  ticketId: z.string(),
  status: fixReportStatusSchema,
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

export type FixReport = z.infer<typeof fixReportSchema>;
