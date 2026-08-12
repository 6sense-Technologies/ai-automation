import type { Env, PipelineConfig } from "../config.js";
import { GenericRemediator } from "./generic.js";
import type { AgentProvider } from "./types.js";

type ProviderFactory = (env: Env, config: PipelineConfig) => AgentProvider;

const factories: Record<string, ProviderFactory> = {
  generic: () => new GenericRemediator(),
};

export class ProviderRegistry {
  private readonly instances = new Map<string, AgentProvider>();

  constructor(
    private readonly env: Env,
    private readonly config: PipelineConfig,
  ) {}

  get(name: string): AgentProvider {
    const resolved = !name || name === "cursor" ? "generic" : name;
    const cached = this.instances.get(resolved);
    if (cached) return cached;
    const factory = factories[resolved];
    if (!factory) {
      throw new Error(
        `Unknown remediator "${name}". Registered: ${Object.keys(factories).join(", ")}`,
      );
    }
    const provider = factory(this.env, this.config);
    this.instances.set(resolved, provider);
    return provider;
  }
}
