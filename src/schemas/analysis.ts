import { z } from "zod";

export const analysisStatusSchema = z.enum(["ok", "cannot_find_root_cause", "needs_more_info"]);
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

export const codeLocationSchema = z.object({
  file: z.string(),
  symbol: z.string().default(""),
  lines: z.string().default(""),
  citation: z.string().default(""),
});

export const testPlanEntrySchema = z.object({
  file: z.string(),
  action: z.enum(["add", "modify"]),
  covers: z.string(),
});

/**
 * Phase A output. Produced by the agent, validated by the orchestrator,
 * stored in Mongo, and rendered as a Jira comment.
 */
export const analysisReportSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    ticketId: z.string(),
    status: analysisStatusSchema,
    bugUnderstanding: z.object({
      restatement: z.string(),
      expectedBehavior: z.string(),
      actualBehavior: z.string(),
      severityAssessment: z.enum(["critical", "high", "medium", "low"]),
    }),
    rootCause: z
      .object({
        mechanism: z.string(),
        locations: z.array(codeLocationSchema),
      })
      .optional(),
    proposedFix: z
      .object({
        approach: z.string(),
        filesToTouch: z.array(z.string()),
        riskLevel: z.enum(["low", "medium", "high"]),
        riskNotes: z.string().default(""),
        testPlan: z.array(testPlanEntrySchema),
      })
      .optional(),
    /** Agent self-assessed confidence in the analysis, 0..1. */
    confidence: z.number().min(0).max(1),
    /** Populated when status is not "ok": what blocked the analysis / what info is missing. */
    blockers: z.string().default(""),
  })
  .superRefine((report, ctx) => {
    if (report.status === "ok") {
      if (!report.rootCause) {
        ctx.addIssue({ code: "custom", path: ["rootCause"], message: 'required when status is "ok"' });
      }
      if (!report.proposedFix) {
        ctx.addIssue({ code: "custom", path: ["proposedFix"], message: 'required when status is "ok"' });
      }
    }
  });

export type AnalysisReport = z.infer<typeof analysisReportSchema>;
