import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import "dotenv/config";
import YAML from "yaml";
import { z } from "zod";

const envSchema = z.object({
  CURSOR_API_KEY: z.string().min(1, "CURSOR_API_KEY is required"),
  JIRA_BASE_URL: z.string().url().transform((u) => u.replace(/\/$/, "")),
  JIRA_EMAIL: z.string().min(1),
  JIRA_API_TOKEN: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(8, "WEBHOOK_SECRET must be at least 8 characters"),
  API_KEY: z.string().min(8, "API_KEY must be at least 8 characters"),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default("bugfix_pipeline"),
  PORT: z.coerce.number().int().positive().default(3000),
  CONFIG_PATH: z.string().default("pipeline.config.yaml"),
  WORK_DIR: z.string().default(join(homedir(), ".jira-bugfix-pipeline", "work")),
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

const projectConfigSchema = z.object({
  repo: z.string().min(1),
  baseBranch: z.string().default("beta"),
  testCommand: z.string().min(1),
  /** Milliseconds allowed for the verification test run. */
  testTimeoutMs: z.number().int().positive().default(15 * 60 * 1000),
  provider: z.string().optional(),
  componentRepoMap: z.record(z.string(), z.string()).default({}),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

const pipelineConfigSchema = z.object({
  defaultProvider: z.string().default("cursor"),
  providers: z
    .record(z.string(), z.object({ model: z.string().default("composer-2.5") }).partial())
    .default({}),
  projects: z.record(z.string(), projectConfigSchema),
  // Future roadmap (designed, not implemented):
  // autoApproveThreshold: z.number().min(0).max(1).optional(),
});

export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;

export function loadPipelineConfig(configPath: string): PipelineConfig {
  const absolute = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch (err) {
    throw new Error(`Cannot read pipeline config at ${absolute}: ${(err as Error).message}`);
  }
  const parsed = pipelineConfigSchema.safeParse(YAML.parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid pipeline config at ${absolute}: ${issues}`);
  }
  return parsed.data;
}

export interface ResolvedProject {
  projectKey: string;
  repoUrl: string;
  baseBranch: string;
  testCommand: string;
  testTimeoutMs: number;
  provider: string;
  model: string | undefined;
}

/**
 * Map a Jira issue (project key + components) to a target repo and provider.
 * A component present in componentRepoMap overrides the project-level repo.
 */
export function resolveProject(
  config: PipelineConfig,
  issueKey: string,
  components: string[] = [],
): ResolvedProject {
  const projectKey = issueKey.split("-")[0]!;
  const project = config.projects[projectKey];
  if (!project) {
    throw new Error(
      `No project mapping for Jira project "${projectKey}" (issue ${issueKey}). Add it to pipeline.config.yaml.`,
    );
  }
  let repoUrl = project.repo;
  for (const component of components) {
    const mapped = project.componentRepoMap[component];
    if (mapped) {
      repoUrl = mapped;
      break;
    }
  }
  const provider = project.provider ?? config.defaultProvider;
  return {
    projectKey,
    repoUrl,
    baseBranch: project.baseBranch,
    testCommand: project.testCommand,
    testTimeoutMs: project.testTimeoutMs,
    provider,
    model: config.providers[provider]?.model,
  };
}
