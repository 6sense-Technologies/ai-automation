import type { Env, PipelineConfig } from "../config.js";
import { CursorSdkProvider } from "./cursor.js";
import type { AgentProvider } from "./types.js";

type ProviderFactory = (env: Env, config: PipelineConfig) => AgentProvider;

/**
 * Provider registry. To plug in another coding agent (Claude Code, OpenCode,
 * ...), implement AgentProvider and add a factory here; select it via
 * `defaultProvider` or a per-project `provider` in pipeline.config.yaml.
 */
const factories: Record<string, ProviderFactory> = {
  cursor: (env, config) =>
    new CursorSdkProvider({
      apiKey: env.CURSOR_API_KEY,
      defaultModel: config.providers["cursor"]?.model,
    }),
};

export class ProviderRegistry {
  private readonly instances = new Map<string, AgentProvider>();

  constructor(
    private readonly env: Env,
    private readonly config: PipelineConfig,
  ) {}

  get(name: string): AgentProvider {
    const cached = this.instances.get(name);
    if (cached) return cached;
    const factory = factories[name];
    if (!factory) {
      throw new Error(
        `Unknown agent provider "${name}". Registered providers: ${Object.keys(factories).join(", ")}`,
      );
    }
    const provider = factory(this.env, this.config);
    this.instances.set(name, provider);
    return provider;
  }
}
