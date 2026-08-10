import { describe, expect, it } from "vitest";
import { analysisReportSchema } from "../src/schemas/analysis.js";
import { fixReportSchema } from "../src/schemas/fix.js";
import { jiraWebhookPayloadSchema } from "../src/schemas/webhook.js";

const validAnalysis = {
  ticketId: "PROJ-123",
  status: "ok",
  bugUnderstanding: {
    restatement: "Submitting an order with an empty cart throws a 500.",
    expectedBehavior: "A 400 with a validation message.",
    actualBehavior: "Unhandled TypeError, 500 response.",
    severityAssessment: "high",
  },
  rootCause: {
    mechanism: "cart.items is undefined when the cart cookie is missing.",
    locations: [{ file: "src/orders/submit.ts", symbol: "submitOrder", lines: "42-55", citation: "cart.items.map(...)" }],
  },
  proposedFix: {
    approach: "Guard against a missing cart before iterating items.",
    filesToTouch: ["src/orders/submit.ts"],
    riskLevel: "low",
    riskNotes: "",
    testPlan: [{ file: "src/orders/submit.test.ts", action: "add", covers: "empty-cart submission returns 400" }],
  },
  confidence: 0.9,
};

describe("analysisReportSchema", () => {
  it("accepts a complete ok report and applies defaults", () => {
    const report = analysisReportSchema.parse(validAnalysis);
    expect(report.schemaVersion).toBe(1);
    expect(report.blockers).toBe("");
  });

  it('requires rootCause and proposedFix when status is "ok"', () => {
    const { rootCause: _rc, proposedFix: _pf, ...withoutCause } = validAnalysis;
    const result = analysisReportSchema.safeParse(withoutCause);
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("rootCause");
    expect(paths).toContain("proposedFix");
  });

  it("allows omitting rootCause/proposedFix when the agent is blocked", () => {
    const blocked = analysisReportSchema.parse({
      ticketId: "PROJ-124",
      status: "needs_more_info",
      bugUnderstanding: validAnalysis.bugUnderstanding,
      confidence: 0.2,
      blockers: "No reproduction steps and the stack trace is truncated.",
    });
    expect(blocked.rootCause).toBeUndefined();
  });

  it("rejects out-of-range confidence", () => {
    expect(analysisReportSchema.safeParse({ ...validAnalysis, confidence: 1.5 }).success).toBe(false);
  });
});

describe("fixReportSchema", () => {
  it("round-trips a delivered report", () => {
    const report = fixReportSchema.parse({
      ticketId: "PROJ-123",
      status: "delivered",
      branchName: "bugfix/PROJ-123-empty-cart-500",
      diffSummary: {
        filesChanged: [{ file: "src/orders/submit.ts", additions: 5, deletions: 1 }],
        commits: ["abc1234 PROJ-123: guard empty cart"],
      },
      testResults: { command: "npm test", passed: true, output: "", newTests: ["submit.test.ts"] },
      verification: "Reproduced the 500 before the fix; returns 400 after.",
      deviations: [],
    });
    expect(report.schemaVersion).toBe(1);
  });

  it("rejects unknown statuses", () => {
    expect(
      fixReportSchema.safeParse({
        ticketId: "PROJ-123",
        status: "partially_done",
        branchName: "x",
        diffSummary: { filesChanged: [], commits: [] },
        testResults: { command: "npm test", passed: true, output: "", newTests: [] },
        verification: "",
        deviations: [],
      }).success,
    ).toBe(false);
  });
});

describe("jiraWebhookPayloadSchema", () => {
  it("parses a minimal payload and defaults the rest", () => {
    const payload = jiraWebhookPayloadSchema.parse({ issueKey: "PROJ-9", summary: "It broke" });
    expect(payload.phase).toBe("analyze");
    expect(payload.components).toEqual([]);
    expect(payload.attachments).toEqual([]);
  });

  it("accepts comma-separated smart-value lists", () => {
    const payload = jiraWebhookPayloadSchema.parse({
      issueKey: "PROJ-9",
      summary: "It broke",
      components: "backend, api",
      labels: "urgent",
    });
    expect(payload.components).toEqual(["backend", "api"]);
    expect(payload.labels).toEqual(["urgent"]);
  });

  it("normalizes string attachments into {filename, url}", () => {
    const payload = jiraWebhookPayloadSchema.parse({
      issueKey: "PROJ-9",
      summary: "It broke",
      attachments: ["https://site.atlassian.net/secure/attachment/1/trace.log"],
    });
    expect(payload.attachments).toEqual([
      { filename: "trace.log", url: "https://site.atlassian.net/secure/attachment/1/trace.log" },
    ]);
  });

  it("rejects non-Jira issue keys", () => {
    expect(jiraWebhookPayloadSchema.safeParse({ issueKey: "not-a-key", summary: "x" }).success).toBe(false);
  });
});
