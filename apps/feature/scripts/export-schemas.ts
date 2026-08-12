/**
 * Export feature pipeline schemas as JSON Schema documents.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { featurePlanSchema } from "../src/schemas/plan.js";
import { implementOutcomeSchema, implementReportSchema } from "../src/schemas/implement.js";
import { jiraWebhookPayloadSchema } from "../src/schemas/webhook.js";

const outDir = join(import.meta.dirname, "..", "schemas-json");
mkdirSync(outDir, { recursive: true });

const schemas = {
  "feature-plan": featurePlanSchema,
  "implement-outcome": implementOutcomeSchema,
  "implement-report": implementReportSchema,
  "jira-webhook-payload": jiraWebhookPayloadSchema,
} as const;

for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { io: "input" });
  writeFileSync(join(outDir, `${name}.schema.json`), JSON.stringify(json, null, 2) + "\n");
  console.log(`wrote schemas-json/${name}.schema.json`);
}
