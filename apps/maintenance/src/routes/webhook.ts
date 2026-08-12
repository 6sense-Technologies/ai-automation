import type { FastifyInstance } from "fastify";
import { secretMatches } from "@ai-auto/http";
import type { AppContext } from "../context.js";
import { runRemediation } from "../pipeline/orchestrator.js";
import { createJobBodySchema } from "../schemas/jobRequest.js";

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/webhooks/maintenance", async (request, reply) => {
    if (!secretMatches(request.headers["x-webhook-secret"] as string | undefined, ctx.env.WEBHOOK_SECRET)) {
      return reply.code(401).send({ error: "invalid webhook secret" });
    }

    const parsed = createJobBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid body",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const job = await ctx.jobs.create(parsed.data);
    await ctx.audit.record(job.jobId, "maintain", "webhook_received", parsed.data.repositoryId ?? "");
    ctx.queue.push(`maint:${job.jobId}`, () => runRemediation(ctx, job.jobId));

    return reply.code(202).send({ status: "queued", jobId: job.jobId });
  });
}
