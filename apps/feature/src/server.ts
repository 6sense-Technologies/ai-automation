import { secretMatches } from "@ai-auto/http";
import type { AuditLog, MongoHandle } from "@ai-auto/mongo";
import type { JobQueue } from "@ai-auto/pipeline-core";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Env, PipelineConfig } from "./config.js";
import { LABELS } from "./config.js";
import type { Logger } from "@ai-auto/logger";

export interface FeatureContext {
  env: Env;
  config: PipelineConfig;
  logger: Logger;
  audit: AuditLog;
  queue: JobQueue;
  mongo: MongoHandle;
  mongoPing(): Promise<boolean>;
}

export function buildServer(ctx: FeatureContext): FastifyInstance {
  const app = Fastify({
    loggerInstance: ctx.logger as unknown as FastifyBaseLogger,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.get("/healthz", async (_request, reply) => {
    const mongoOk = await ctx.mongoPing();
    return reply.code(mongoOk ? 200 : 503).send({
      ok: mongoOk,
      service: "feature",
      queueDepth: ctx.queue.pending,
      labels: LABELS,
    });
  });

  app.post("/webhooks/jira", async (request, reply) => {
    if (!secretMatches(request.headers["x-webhook-secret"] as string | undefined, ctx.env.WEBHOOK_SECRET)) {
      return reply.code(401).send({ error: "invalid webhook secret" });
    }

    const body = request.body as { issueKey?: string; summary?: string } | undefined;
    const issueKey = body?.issueKey?.toUpperCase();
    if (!issueKey) {
      return reply.code(400).send({ error: "issueKey is required" });
    }

    await ctx.audit.record(issueKey, "plan", "trigger_received", body?.summary ?? "");
    ctx.logger.info({ issueKey }, "feature webhook accepted (scaffold — pipeline not implemented yet)");

    // Owner: implement plan → approve → implement state machine here (see apps/bugfix).
    return reply.code(202).send({
      status: "accepted_scaffold",
      issueKey,
      message: "Feature pipeline scaffold is running; wire Phase A/B next.",
    });
  });

  app.get("/api/status", async (request, reply) => {
    if (!secretMatches(request.headers["x-api-key"] as string | undefined, ctx.env.API_KEY)) {
      return reply.code(401).send({ error: "invalid API key" });
    }
    return reply.send({
      service: "feature",
      labels: LABELS,
      branchPrefix: "feature",
      ready: false,
      note: "Scaffold only — implement planning and implementation phases.",
    });
  });

  return app;
}
