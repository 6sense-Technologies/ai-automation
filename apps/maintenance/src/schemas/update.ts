import { z } from "zod";

export const updateAttemptSchema = z.object({
  packageName: z.string(),
  attemptedVersion: z.string(),
  success: z.boolean(),
  validationOutput: z.string().default(""),
  error: z.string().optional(),
});

export type UpdateAttempt = z.infer<typeof updateAttemptSchema>;

export const updateReportSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  status: z.enum(["delivered", "needs_manual", "reverted", "failed"]),
  branchName: z.string().optional(),
  prUrl: z.string().optional(),
  applied: z.array(z.object({ packageName: z.string(), version: z.string() })).default([]),
  attempts: z.array(updateAttemptSchema).default([]),
  testResults: z
    .object({
      command: z.string(),
      passed: z.boolean(),
      output: z.string(),
    })
    .optional(),
  auditCleared: z.boolean().optional(),
  summary: z.string().default(""),
});

export type UpdateReport = z.infer<typeof updateReportSchema>;
