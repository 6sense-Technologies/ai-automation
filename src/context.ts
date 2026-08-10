import type { Env, PipelineConfig } from "./config.js";
import type { RepoManager } from "./git/repoManager.js";
import type { JiraClient } from "./jira/client.js";
import type { Logger } from "./logger.js";
import type { JobQueue } from "./pipeline/queue.js";
import type { ProviderRegistry } from "./providers/registry.js";
import type { AuditLog } from "./store/audit.js";
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
