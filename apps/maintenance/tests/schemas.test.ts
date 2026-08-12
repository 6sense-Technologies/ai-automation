import { describe, expect, it } from "vitest";
import { analysisReportSchema } from "../src/schemas/analysis.js";
import { createJobBodySchema } from "../src/schemas/jobRequest.js";

describe("maintenance schemas", () => {
  it("parses a create job body", () => {
    const parsed = createJobBodySchema.parse({
      repositoryId: "694a8bde0d688b6d5f0ef9cb",
      projectKey: "DEFAULT",
      vulnerabilities: [{ packageName: "lodash", severity: "High", recommendedVersion: "4.17.21" }],
    });
    expect(parsed.vulnerabilities).toHaveLength(1);
    expect(parsed.createPullRequest).toBe(true);
  });

  it("parses an analysis report", () => {
    const report = analysisReportSchema.parse({
      schemaVersion: 1,
      status: "ok",
      summary: "Bump lodash",
      vulnerabilitiesReviewed: 1,
      candidates: [
        {
          packageName: "lodash",
          toVersion: "4.17.21",
          updateType: "patch",
          rationale: "patched advisory",
        },
      ],
      fallbacks: [],
      risks: [],
      confidence: 0.8,
      blockers: "",
    });
    expect(report.candidates[0]?.toVersion).toBe("4.17.21");
  });
});
