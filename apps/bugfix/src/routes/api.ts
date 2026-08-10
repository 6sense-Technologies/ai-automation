import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { TICKET_STATES, type TicketState } from "../pipeline/machine.js";
import { runPhaseB } from "../pipeline/phaseB.js";
import { approveBodySchema, ISSUE_KEY_REGEX } from "../schemas/webhook.js";
import { secretMatches } from "./webhook.js";

export function registerApiRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Liveness (unauthenticated): includes a Mongo ping.
  app.get("/healthz", async (_request, reply) => {
    const mongoOk = await ctx.mongoPing();
    return reply.code(mongoOk ? 200 : 503).send({ ok: mongoOk, queueDepth: ctx.queue.pending });
  });

  app.register(async (api) => {
    api.addHook("onRequest", async (request, reply) => {
      if (!secretMatches(request.headers["x-api-key"] as string | undefined, ctx.env.API_KEY)) {
        ctx.logger.warn(
          { step: "api.auth_failed", path: request.url },
          "API request rejected: invalid X-Api-Key",
        );
        return reply.code(401).send({ error: "invalid API key" });
      }
    });

    /**
     * Approval gate for Phase B. Manual for now (curl/Postman); any future
     * trigger (Slack button, Jira transition rule, dashboard) calls this same
     * endpoint. Atomic state guard makes double-calls harmless (409).
     */
    api.post<{ Params: { issueKey: string } }>("/api/tickets/:issueKey/approve", async (request, reply) => {
      const issueKey = request.params.issueKey.toUpperCase();
      const log = ctx.logger.child({ issueKey });

      if (!ISSUE_KEY_REGEX.test(issueKey)) {
        log.warn({ step: "approve.invalid_key" }, "approval rejected: invalid issue key");
        return reply.code(400).send({ error: "invalid issue key" });
      }

      const body = approveBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        log.warn({ step: "approve.invalid_body" }, "approval rejected: invalid body");
        return reply.code(400).send({ error: "invalid body", issues: body.error.issues.map((i) => i.message) });
      }

      log.info({ step: "approve.received", notes: body.data.notes || undefined }, "approval request received");

      const ticket = await ctx.tickets.approve(issueKey, body.data.notes);
      if (!ticket) {
        const current = await ctx.tickets.get(issueKey);
        log.warn(
          { step: "approve.rejected", state: current?.state ?? null },
          "approval rejected: ticket not in AWAITING_APPROVAL",
        );
        return reply.code(409).send({
          error: current
            ? `ticket is in state ${current.state}, expected AWAITING_APPROVAL`
            : "unknown ticket",
          issueKey,
          state: current?.state ?? null,
        });
      }

      await ctx.audit.record(issueKey, "fix", "approval_received", body.data.notes);
      log.info({ step: "approve.queued", state: "FIXING" }, "Phase B queued (AWAITING_APPROVAL → FIXING)");
      ctx.queue.push(`phaseB:${issueKey}`, () => runPhaseB(ctx, issueKey));
      return reply.code(202).send({ status: "fix_queued", issueKey });
    });

    // Ticket detail: state, reports, and full audit trail.
    api.get<{ Params: { issueKey: string } }>("/api/tickets/:issueKey", async (request, reply) => {
      const issueKey = request.params.issueKey.toUpperCase();
      const ticket = await ctx.tickets.get(issueKey);
      if (!ticket) return reply.code(404).send({ error: "unknown ticket", issueKey });
      const trail = await ctx.audit.trail(issueKey);
      ctx.logger.info({ step: "api.ticket_status", issueKey, state: ticket.state }, "ticket status fetched");
      return reply.send({ ticket, auditTrail: trail });
    });

    // Ticket list, filterable by state: /api/tickets?state=AWAITING_APPROVAL
    api.get<{ Querystring: { state?: string } }>("/api/tickets", async (request, reply) => {
      const stateParam = request.query.state?.toUpperCase();
      if (stateParam && !TICKET_STATES.includes(stateParam as TicketState)) {
        return reply.code(400).send({ error: `invalid state, expected one of ${TICKET_STATES.join(", ")}` });
      }
      const tickets = await ctx.tickets.list(stateParam as TicketState | undefined);
      return reply.send({ tickets });
    });
  });
}
