import { mkdirSync } from "node:fs";
import { createLogger } from "@ai-auto/logger";
import { AuditLog, connectMongo } from "@ai-auto/mongo";
import { JobQueue } from "@ai-auto/pipeline-core";
import { loadEnv, loadPipelineConfig } from "./config.js";
import { buildServer, type FeatureContext } from "./server.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const config = loadPipelineConfig(env.CONFIG_PATH);

  mkdirSync(env.WORK_DIR, { recursive: true });

  logger.info({ db: env.MONGODB_DB }, "connecting to MongoDB");
  const mongo = await connectMongo(env.MONGODB_URI, env.MONGODB_DB);

  const ctx: FeatureContext = {
    env,
    config,
    logger,
    audit: new AuditLog(mongo.db),
    queue: new JobQueue(logger),
    mongo,
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
    { port: env.PORT, projects: Object.keys(config.projects) },
    "feature automation scaffold listening",
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
