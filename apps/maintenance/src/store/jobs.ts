import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { FailureReason } from "@ai-auto/errors";
import { COLLECTIONS } from "@ai-auto/mongo";
import { ACTIVE_STATES, type JobState } from "../pipeline/machine.js";
import type { AnalysisReport } from "../schemas/analysis.js";
import type { CreateJobBody, Vulnerability } from "../schemas/jobRequest.js";
import type { UpdateReport } from "../schemas/update.js";

export interface JobDoc {
  jobId: string;
  state: JobState;
  request: CreateJobBody;
  repositoryId?: string;
  vulnerabilities: Vulnerability[];
  analysisReport?: AnalysisReport;
  updateReport?: UpdateReport;
  branchName?: string;
  prUrl?: string;
  attemptIndex: number;
  failureReason?: FailureReason;
  failureDetail?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class JobStore {
  constructor(private readonly db: Db) {}

  private get jobs() {
    return this.db.collection<JobDoc>(COLLECTIONS.jobs);
  }

  async create(request: CreateJobBody): Promise<JobDoc> {
    const now = new Date();
    const job: JobDoc = {
      jobId: `MAINT-${randomUUID().slice(0, 8).toUpperCase()}`,
      state: "RECEIVED",
      request,
      repositoryId: request.repositoryId,
      vulnerabilities: request.vulnerabilities ?? [],
      attemptIndex: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.jobs.insertOne(job);
    return job;
  }

  async transition(
    jobId: string,
    from: JobState | JobState[],
    to: JobState,
    patch: Partial<JobDoc> = {},
  ): Promise<JobDoc | null> {
    const fromStates = Array.isArray(from) ? from : [from];
    return this.jobs.findOneAndUpdate(
      { jobId, state: { $in: fromStates } },
      { $set: { ...patch, state: to, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  }

  async markFailed(
    jobId: string,
    reason: FailureReason,
    detail: string,
    patch: Partial<JobDoc> = {},
  ): Promise<JobDoc | null> {
    return this.jobs.findOneAndUpdate(
      { jobId, state: { $nin: ["DELIVERED"] satisfies JobState[] } },
      {
        $set: {
          ...patch,
          state: reason === "needs_manual" || reason === "no_suitable_version" ? "NEEDS_MANUAL" : "FAILED",
          failureReason: reason,
          failureDetail: detail,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
  }

  async get(jobId: string): Promise<JobDoc | null> {
    return this.jobs.findOne({ jobId }, { projection: { _id: 0 } });
  }

  async latestForRepository(repositoryId: string): Promise<JobDoc | null> {
    return this.jobs.findOne(
      { repositoryId },
      { projection: { _id: 0 }, sort: { updatedAt: -1 } },
    );
  }

  async list(state?: JobState, limit = 100): Promise<JobDoc[]> {
    const filter = state ? { state } : {};
    return this.jobs
      .find(filter, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
  }

  isActive(job: JobDoc): boolean {
    return ACTIVE_STATES.includes(job.state);
  }
}
