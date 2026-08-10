import { mkdirSync } from "node:fs";
import { loadEnv, loadPipelineConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { RepoManager } from "./git/repoManager.js";
import { JiraClient } from "./jira/client.js";
import { createLogger } from "./logger.js";
import { JobQueue } from "./pipeline/queue.js";
import { ProviderRegistry } from "./providers/registry.js";
import { buildServer } from "./server.js";
import { AuditLog } from "./store/audit.js";
import { connectMongo } from "./store/mongo.js";
import { TicketStore } from "./store/tickets.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const config = loadPipelineConfig(env.CONFIG_PATH);

  mkdirSync(env.WORK_DIR, { recursive: true });

  logger.info({ db: env.MONGODB_DB }, "connecting to MongoDB");
  const mongo = await connectMongo(env.MONGODB_URI, env.MONGODB_DB);

  const ctx: AppContext = {
    env,
    config,
    logger,
    tickets: new TicketStore(mongo.db),
    audit: new AuditLog(mongo.db),
    jira: new JiraClient(
      { baseUrl: env.JIRA_BASE_URL, email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN },
      logger,
    ),
    repos: new RepoManager(env.WORK_DIR),
    providers: new ProviderRegistry(env, config),
    queue: new JobQueue(logger),
    mongoPing: async () => {
      try {
        await mongo.db.command({ ping: 1 });
        return true;
      } catch {
        return false;
      }
    },
  };

  const app = buildServer(ctx);
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(
    { port: env.PORT, projects: Object.keys(config.projects), defaultProvider: config.defaultProvider },
    "jira-bugfix-pipeline listening",
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await app.close();
    await mongo.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
