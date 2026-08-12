import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import "dotenv/config";
import YAML from "yaml";
import { z } from "zod";

export interface EnvDefaults {
  mongodbDb: string;
  port: number;
  workDir: string;
  configPath?: string;
}

export function createEnvSchema(defaults: EnvDefaults) {
  return z.object({
    CURSOR_API_KEY: z.string().min(1, "CURSOR_API_KEY is required"),
    JIRA_BASE_URL: z.string().url().transform((u) => u.replace(/\/$/, "")),
    JIRA_EMAIL: z.string().min(1),
    JIRA_API_TOKEN: z.string().min(1),
    WEBHOOK_SECRET: z.string().min(8, "WEBHOOK_SECRET must be at least 8 characters"),
    API_KEY: z.string().min(8, "API_KEY must be at least 8 characters"),
    MONGODB_URI: z.string().min(1),
    MONGODB_DB: z.string().default(defaults.mongodbDb),
    PORT: z.coerce.number().int().positive().default(defaults.port),
    CONFIG_PATH: z.string().default(defaults.configPath ?? "pipeline.config.yaml"),
    WORK_DIR: z.string().default(defaults.workDir),
    LOG_LEVEL: z.string().default("info"),
    /** Optional GitHub token for opening PRs from the maintenance pipeline. */
    GITHUB_TOKEN: z.string().optional(),
  });
}

export type Env = z.infer<ReturnType<typeof createEnvSchema>>;

export function loadEnv(defaults: EnvDefaults, source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = createEnvSchema(defaults).safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

/** Convenience defaults for the bugfix service. */
export function bugfixEnvDefaults(): EnvDefaults {
  return {
    mongodbDb: "ai_bugfix",
    port: 3000,
    workDir: join(homedir(), ".ai-automation", "bugfix", "work"),
  };
}

export function featureEnvDefaults(): EnvDefaults {
  return {
    mongodbDb: "ai_feature",
    port: 3001,
    workDir: join(homedir(), ".ai-automation", "feature", "work"),
  };
}

export function maintenanceEnvDefaults(): EnvDefaults {
  return {
    mongodbDb: "ai_maintenance",
    port: 3002,
    workDir: join(homedir(), ".ai-automation", "maintenance", "work"),
  };
}

const projectConfigSchema = z.object({
  repo: z.string().min(1),
  baseBranch: z.string().default("beta"),
  testCommand: z.string().min(1),
  /** Milliseconds allowed for the verification test run. */
  testTimeoutMs: z.number().int().positive().default(15 * 60 * 1000),
  provider: z.string().optional(),
  componentRepoMap: z.record(z.string(), z.string()).default({}),
  /** Maintenance / dependency remediation (optional; npm defaults apply when omitted). */
  packageManager: z.enum(["npm", "yarn", "pnpm"]).default("npm"),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  auditCommand: z.string().optional(),
  maxVersionRetries: z.number().int().positive().default(3),
  allowMajorUpdates: z.boolean().default(false),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

const pipelineConfigSchema = z.object({
  defaultProvider: z.string().default("cursor"),
  providers: z
    .record(z.string(), z.object({ model: z.string().default("composer-2.5") }).partial())
    .default({}),
  projects: z.record(z.string(), projectConfigSchema),
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
  packageManager: "npm" | "yarn" | "pnpm";
  installCommand?: string;
  buildCommand?: string;
  auditCommand?: string;
  maxVersionRetries: number;
  allowMajorUpdates: boolean;
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
    packageManager: project.packageManager,
    installCommand: project.installCommand,
    buildCommand: project.buildCommand,
    auditCommand: project.auditCommand,
    maxVersionRetries: project.maxVersionRetries,
    allowMajorUpdates: project.allowMajorUpdates,
  };
}
