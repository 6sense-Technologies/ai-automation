import { bugfixEnvDefaults, loadEnv as loadSharedEnv, type Env } from "@ai-auto/config";

export {
  loadPipelineConfig,
  resolveProject,
  type PipelineConfig,
  type ProjectConfig,
  type ResolvedProject,
} from "@ai-auto/config";

export type { Env };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return loadSharedEnv(bugfixEnvDefaults(), source);
}
