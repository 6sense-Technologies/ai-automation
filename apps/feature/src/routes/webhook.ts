import { secretMatches } from "@ai-auto/http";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { runPhaseA } from "../pipeline/phaseA.js";
import { jiraWebhookPayloadSchema } from "../schemas/webhook.js";
import { deliveryHash } from "../store/tickets.js";

export { secretMatches };

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/webhooks/jira", async (request, reply) => {
    if (!secretMatches(request.headers["x-webhook-secret"] as string | undefined, ctx.env.WEBHOOK_SECRET)) {
      ctx.logger.warn({ step: "webhook.auth_failed" }, "webhook rejected: invalid X-Webhook-Secret");
      return reply.code(401).send({ error: "invalid webhook secret" });
    }

    const parsed = jiraWebhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      ctx.logger.warn({ step: "webhook.invalid_payload", issues }, "webhook payload rejected");
      return reply.code(400).send({ error: "invalid payload", issues });
    }
    const payload = parsed.data;
    const log = ctx.logger.child({ issueKey: payload.issueKey });

    // Soft guard: prefer tickets that carry the feature-improvement label.
    if (!payload.labels.map((l) => l.toLowerCase()).includes("feature-improvement")) {
      log.warn(
        { step: "webhook.label_missing", labels: payload.labels },
        "accepted but label feature-improvement missing — check Automation JQL",
      );
    }

    log.info(
      { step: "webhook.received", summary: payload.summary, issueType: payload.issueType, labels: payload.labels },
      "feature webhook received from Jira",
    );

    const hash = deliveryHash(JSON.stringify(request.body));
    const firstDelivery = await ctx.tickets.recordDelivery(payload.issueKey, payload.phase, hash);
    if (!firstDelivery) {
      log.info({ step: "webhook.duplicate" }, "duplicate webhook delivery dropped");
      await ctx.audit.record(payload.issueKey, "plan", "duplicate_delivery_dropped");
      return reply.code(202).send({ status: "duplicate_delivery_ignored", issueKey: payload.issueKey });
    }

    await ctx.audit.record(payload.issueKey, "plan", "trigger_received", `summary=${payload.summary}`);

    const { shouldPlan, ticket } = await ctx.tickets.registerReceived(payload);
    if (!shouldPlan) {
      log.info({ step: "webhook.ignored", state: ticket.state }, "trigger ignored: ticket already in progress or done");
      return reply.code(202).send({
        status: "already_processed",
        issueKey: payload.issueKey,
        state: ticket.state,
      });
    }

    log.info({ step: "webhook.queued", state: ticket.state }, "Phase A queued (RECEIVED → will PLAN)");
    ctx.queue.push(`phaseA:${payload.issueKey}`, () => runPhaseA(ctx, payload));
    return reply.code(202).send({ status: "plan_queued", issueKey: payload.issueKey });
  });
}
