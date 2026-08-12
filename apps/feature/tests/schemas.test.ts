import { describe, expect, it } from "vitest";
import { featureBranchName, featureBranchPattern, slugify } from "../src/pipeline/naming.js";
import { featurePlanSchema } from "../src/schemas/plan.js";
import { jiraWebhookPayloadSchema } from "../src/schemas/webhook.js";

describe("slugify / feature branches", () => {
  it("builds feature/<TICKET>-<slug>", () => {
    expect(featureBranchName("JAD-1", "Add empty state")).toBe("feature/JAD-1-add-empty-state");
    expect(featureBranchPattern("JAD-1")).toBe("refs/heads/feature/JAD-1-*");
    expect(slugify("Hello World")).toBe("hello-world");
  });
});

describe("featurePlanSchema", () => {
  it("requires proposedDesign when ok", () => {
    const bad = featurePlanSchema.safeParse({
      ticketId: "JAD-1",
      status: "ok",
      featureUnderstanding: {
        restatement: "x",
        goal: "y",
        priorityAssessment: "medium",
      },
      confidence: 0.5,
    });
    expect(bad.success).toBe(false);
  });

  it("accepts a complete ok plan", () => {
    const report = featurePlanSchema.parse({
      ticketId: "JAD-1",
      status: "ok",
      featureUnderstanding: {
        restatement: "Add empty state",
        goal: "Show empty UI at 0%",
        acceptanceCriteria: ["Visible at 0%"],
        outOfScope: ["Full redesign"],
        priorityAssessment: "medium",
      },
      proposedDesign: {
        approach: "Add EmptyState component",
        filesToTouch: ["components/EmptyState.tsx"],
        riskLevel: "low",
        testPlan: [{ file: "EmptyState.test.tsx", action: "add", covers: "renders at 0%" }],
      },
      confidence: 0.8,
    });
    expect(report.schemaVersion).toBe(1);
  });
});

describe("jiraWebhookPayloadSchema", () => {
  it("defaults phase to plan and parses labels", () => {
    const payload = jiraWebhookPayloadSchema.parse({
      issueKey: "JAD-99",
      summary: "Enhance profile",
      labels: "feature-improvement, ui",
    });
    expect(payload.phase).toBe("plan");
    expect(payload.labels).toEqual(["feature-improvement", "ui"]);
  });
});
