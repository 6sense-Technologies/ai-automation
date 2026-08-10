import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { runPhaseA } from "../pipeline/phaseA.js";
import { jiraWebhookPayloadSchema } from "../schemas/webhook.js";
import { deliveryHash } from "../store/tickets.js";

export function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/webhooks/jira", async (request, reply) => {
    if (!secretMatches(request.headers["x-webhook-secret"] as string | undefined, ctx.env.WEBHOOK_SECRET)) {
      return reply.code(401).send({ error: "invalid webhook secret" });
    }

    const parsed = jiraWebhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      ctx.logger.warn({ issues }, "webhook payload rejected");
      return reply.code(400).send({ error: "invalid payload", issues });
    }
    const payload = parsed.data;
    const log = ctx.logger.child({ issueKey: payload.issueKey });

    // Layer 1: exact duplicate delivery (same body) — acknowledge and drop.
    const hash = deliveryHash(JSON.stringify(request.body));
    const firstDelivery = await ctx.tickets.recordDelivery(payload.issueKey, payload.phase, hash);
    if (!firstDelivery) {
      log.info("duplicate webhook delivery dropped");
      await ctx.audit.record(payload.issueKey, "analyze", "duplicate_delivery_dropped");
      return reply.code(202).send({ status: "duplicate_delivery_ignored", issueKey: payload.issueKey });
    }

    await ctx.audit.record(payload.issueKey, "analyze", "trigger_received", `summary=${payload.summary}`);

    // Layer 2: ticket-level state guard — only new or FAILED tickets start analysis.
    const { shouldAnalyze, ticket } = await ctx.tickets.registerReceived(payload);
    if (!shouldAnalyze) {
      log.info({ state: ticket.state }, "trigger ignored: ticket already in progress or done");
      return reply.code(202).send({
        status: "already_processed",
        issueKey: payload.issueKey,
        state: ticket.state,
      });
    }

    ctx.queue.push(`phaseA:${payload.issueKey}`, () => runPhaseA(ctx, payload));
    return reply.code(202).send({ status: "analysis_queued", issueKey: payload.issueKey });
  });
}
