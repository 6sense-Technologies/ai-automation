import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerWebhookRoutes } from "./routes/webhook.js";

export function buildServer(ctx: AppContext): FastifyInstance {
  // pino's Logger satisfies FastifyBaseLogger at runtime; the generic
  // parameter it would otherwise introduce doesn't unify with the plain
  // FastifyInstance type used by the route modules.
  const app = Fastify({
    loggerInstance: ctx.logger as unknown as FastifyBaseLogger,
    bodyLimit: 2 * 1024 * 1024,
  });
  registerWebhookRoutes(app, ctx);
  registerApiRoutes(app, ctx);
  return app;
}
