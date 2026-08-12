import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerWebhookRoutes } from "./routes/webhook.js";

export function buildServer(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    loggerInstance: ctx.logger as unknown as FastifyBaseLogger,
    bodyLimit: 4 * 1024 * 1024,
  });
  registerWebhookRoutes(app, ctx);
  registerApiRoutes(app, ctx);
  return app;
}
