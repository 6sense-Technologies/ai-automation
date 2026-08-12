import { mkdirSync } from "node:fs";
import { RepoManager } from "@ai-auto/git";
import { JiraClient } from "@ai-auto/jira";
import { createLogger } from "@ai-auto/logger";
import { AuditLog, connectMongo } from "@ai-auto/mongo";
import { JobQueue } from "@ai-auto/pipeline-core";
import { loadEnv, loadPipelineConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { ProviderRegistry } from "./providers/registry.js";
import { buildServer } from "./server.js";
import { JobStore } from "./store/jobs.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const config = loadPipelineConfig(env.CONFIG_PATH);

  mkdirSync(env.WORK_DIR, { recursive: true });

  logger.info({ step: "boot.mongo", db: env.MONGODB_DB }, "connecting to MongoDB");
  const mongo = await connectMongo(env.MONGODB_URI, env.MONGODB_DB);
  logger.info({ step: "boot.mongo_ok", db: env.MONGODB_DB }, "MongoDB connected");

  const ctx: AppContext = {
    env,
    config,
    logger,
    jobs: new JobStore(mongo.db),
    audit: new AuditLog(mongo.db),
    jira:
      env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN
        ? new JiraClient(
            { baseUrl: env.JIRA_BASE_URL, email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN },
            logger,
          )
        : undefined,
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
    {
      step: "boot.ready",
      port: env.PORT,
      projects: Object.keys(config.projects),
      defaultProvider: config.defaultProvider,
      workDir: env.WORK_DIR,
    },
    "maintenance pipeline listening",
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
