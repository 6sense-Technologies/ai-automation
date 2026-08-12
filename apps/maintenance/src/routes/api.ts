import type { FastifyInstance } from "fastify";
import { secretMatches } from "@ai-auto/http";
import type { AppContext } from "../context.js";
import { JOB_STATES, type JobState } from "../pipeline/machine.js";
import { runRemediation } from "../pipeline/orchestrator.js";
import { createJobBodySchema } from "../schemas/jobRequest.js";

export function registerApiRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/healthz", async (_request, reply) => {
    const mongoOk = await ctx.mongoPing();
    return reply.code(mongoOk ? 200 : 503).send({
      ok: mongoOk,
      service: "maintenance",
      queueDepth: ctx.queue.pending,
    });
  });

  app.register(async (api) => {
    api.addHook("onRequest", async (request, reply) => {
      if (!secretMatches(request.headers["x-api-key"] as string | undefined, ctx.env.API_KEY)) {
        return reply.code(401).send({ error: "invalid API key" });
      }
    });

    /** Start a dependency remediation job (TeamPulse Outdated Packages button). */
    api.post("/api/jobs", async (request, reply) => {
      const parsed = createJobBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid body",
          issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
      }

      const body = parsed.data;
      if (body.repositoryId) {
        const latest = await ctx.jobs.latestForRepository(body.repositoryId);
        if (latest && ctx.jobs.isActive(latest)) {
          return reply.code(409).send({
            error: "a remediation job is already active for this repository",
            jobId: latest.jobId,
            state: latest.state,
          });
        }
      }

      const job = await ctx.jobs.create(body);
      await ctx.audit.record(job.jobId, "maintain", "job_created", body.repositoryId ?? "");
      ctx.logger.info({ jobId: job.jobId, repositoryId: body.repositoryId }, "remediation job queued");
      ctx.queue.push(`maint:${job.jobId}`, () => runRemediation(ctx, job.jobId));

      return reply.code(202).send({
        status: "queued",
        jobId: job.jobId,
        state: job.state,
      });
    });

    api.get<{ Params: { jobId: string } }>("/api/jobs/:jobId", async (request, reply) => {
      const job = await ctx.jobs.get(request.params.jobId);
      if (!job) return reply.code(404).send({ error: "unknown job", jobId: request.params.jobId });
      const trail = await ctx.audit.trail(job.jobId);
      return reply.send({ job, auditTrail: trail });
    });

    api.get<{ Querystring: { state?: string; repositoryId?: string } }>("/api/jobs", async (request, reply) => {
      if (request.query.repositoryId) {
        const latest = await ctx.jobs.latestForRepository(request.query.repositoryId);
        return reply.send({ job: latest });
      }
      const stateParam = request.query.state?.toUpperCase();
      if (stateParam && !JOB_STATES.includes(stateParam as JobState)) {
        return reply.code(400).send({ error: `invalid state, expected one of ${JOB_STATES.join(", ")}` });
      }
      const jobs = await ctx.jobs.list(stateParam as JobState | undefined);
      return reply.send({ jobs });
    });
  });
}
