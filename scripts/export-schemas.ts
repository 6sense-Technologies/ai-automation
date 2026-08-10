/**
 * Export the pipeline's structured report schemas as JSON Schema documents
 * into ./schemas-json, so external consumers (dashboards, other services)
 * can validate or render reports without importing this codebase.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { analysisReportSchema } from "../src/schemas/analysis.js";
import { fixOutcomeSchema, fixReportSchema } from "../src/schemas/fix.js";
import { jiraWebhookPayloadSchema } from "../src/schemas/webhook.js";

const outDir = join(process.cwd(), "schemas-json");
mkdirSync(outDir, { recursive: true });

const schemas = {
  "analysis-report": analysisReportSchema,
  "fix-outcome": fixOutcomeSchema,
  "fix-report": fixReportSchema,
  "jira-webhook-payload": jiraWebhookPayloadSchema,
} as const;

for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { io: "input" });
  writeFileSync(join(outDir, `${name}.schema.json`), JSON.stringify(json, null, 2) + "\n");
  console.log(`wrote schemas-json/${name}.schema.json`);
}
