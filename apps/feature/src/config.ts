import { featureEnvDefaults, loadEnv as loadSharedEnv, type Env } from "@ai-auto/config";

export {
  loadPipelineConfig,
  resolveProject,
  type PipelineConfig,
  type ProjectConfig,
  type ResolvedProject,
} from "@ai-auto/config";

export type { Env };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return loadSharedEnv(featureEnvDefaults(), source);
}

/** Feature-specific Jira labels (namespaced from bugfix/maintenance). */
export const LABELS = {
  planReady: "ai-feature-ready",
  delivered: "ai-feature-delivered",
  failed: "ai-feature-failed",
} as const;
