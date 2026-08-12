import { z } from "zod";

export const planStatusSchema = z.enum(["ok", "cannot_plan", "needs_more_info"]);
export type PlanStatus = z.infer<typeof planStatusSchema>;

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
 * Phase A output for feature/enhancement work. Produced by the agent,
 * validated by the orchestrator, stored in Mongo, and posted to Jira.
 */
export const featurePlanSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    ticketId: z.string(),
    status: planStatusSchema,
    featureUnderstanding: z.object({
      restatement: z.string(),
      goal: z.string(),
      acceptanceCriteria: z.array(z.string()).default([]),
      outOfScope: z.array(z.string()).default([]),
      priorityAssessment: z.enum(["critical", "high", "medium", "low"]),
    }),
    proposedDesign: z
      .object({
        approach: z.string(),
        filesToTouch: z.array(z.string()),
        locations: z.array(codeLocationSchema).default([]),
        riskLevel: z.enum(["low", "medium", "high"]),
        riskNotes: z.string().default(""),
        testPlan: z.array(testPlanEntrySchema),
      })
      .optional(),
    confidence: z.number().min(0).max(1),
    blockers: z.string().default(""),
  })
  .superRefine((report, ctx) => {
    if (report.status === "ok" && !report.proposedDesign) {
      ctx.addIssue({ code: "custom", path: ["proposedDesign"], message: 'required when status is "ok"' });
    }
  });

export type FeaturePlan = z.infer<typeof featurePlanSchema>;
