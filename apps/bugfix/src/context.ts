import type { RepoManager } from "@ai-auto/git";
import type { JiraClient } from "@ai-auto/jira";
import type { Logger } from "@ai-auto/logger";
import type { AuditLog } from "@ai-auto/mongo";
import type { JobQueue } from "@ai-auto/pipeline-core";
import type { Env, PipelineConfig } from "./config.js";
import type { ProviderRegistry } from "./providers/registry.js";
import type { TicketStore } from "./store/tickets.js";

/** Everything the routes and phase runners need, wired once at startup. */
export interface AppContext {
  env: Env;
  config: PipelineConfig;
  logger: Logger;
  tickets: TicketStore;
  audit: AuditLog;
  jira: JiraClient;
  repos: RepoManager;
  providers: ProviderRegistry;
  queue: JobQueue;
  mongoPing(): Promise<boolean>;
}
