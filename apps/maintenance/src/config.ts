import { homedir } from "node:os";
import { join } from "node:path";
import "dotenv/config";
import { z } from "zod";
import {
  loadPipelineConfig,
  type PipelineConfig,
  type ProjectConfig,
  type ResolvedProject,
} from "@ai-auto/config";

export { loadPipelineConfig, type PipelineConfig, type ProjectConfig, type ResolvedProject };

const maintenanceEnvSchema = z.object({
  WEBHOOK_SECRET: z.string().min(8, "WEBHOOK_SECRET must be at least 8 characters"),
  API_KEY: z.string().min(8, "API_KEY must be at least 8 characters"),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default("ai_maintenance"),
  PORT: z.coerce.number().int().positive().default(3002),
  CONFIG_PATH: z.string().default("pipeline.config.yaml"),
  WORK_DIR: z.string().default(join(homedir(), ".ai-automation", "maintenance", "work")),
  LOG_LEVEL: z.string().default("info"),
  GITHUB_TOKEN: z.string().optional(),
  /** Optional — only used if you later enable Jira comments. */
  JIRA_BASE_URL: z
    .string()
    .optional()
    .transform((u) => (u ? u.replace(/\/$/, "") : undefined)),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof maintenanceEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = maintenanceEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export const LABELS = {
  ready: "ai-maint-ready",
  delivered: "ai-maint-delivered",
  failed: "ai-maint-failed",
  needsManual: "ai-maint-needs-manual",
} as const;
