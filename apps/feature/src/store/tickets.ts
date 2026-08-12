import { createHash } from "node:crypto";
import { MongoServerError, type Db } from "mongodb";
import type { FailureReason } from "@ai-auto/errors";
import { COLLECTIONS } from "@ai-auto/mongo";
import { ACTIVE_STATES, type TicketState } from "../pipeline/machine.js";
import type { FeaturePlan } from "../schemas/plan.js";
import type { ImplementReport } from "../schemas/implement.js";
import type { JiraWebhookPayload } from "../schemas/webhook.js";

export interface TicketDoc {
  issueKey: string;
  state: TicketState;
  jiraPayload: JiraWebhookPayload;
  featurePlan?: FeaturePlan;
  implementReport?: ImplementReport;
  branchName?: string;
  approvalNotes?: string;
  failureReason?: FailureReason;
  failureDetail?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertResult {
  shouldPlan: boolean;
  ticket: TicketDoc;
}

const DUPLICATE_KEY = 11000;

export function deliveryHash(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export class TicketStore {
  constructor(private readonly db: Db) {}

  private get tickets() {
    return this.db.collection<TicketDoc>(COLLECTIONS.tickets);
  }

  private get deliveries() {
    return this.db.collection(COLLECTIONS.webhookDeliveries);
  }

  async recordDelivery(issueKey: string, phase: string, hash: string): Promise<boolean> {
    try {
      await this.deliveries.insertOne({ issueKey, phase, deliveryHash: hash, receivedAt: new Date() });
      return true;
    } catch (err) {
      if (err instanceof MongoServerError && err.code === DUPLICATE_KEY) return false;
      throw err;
    }
  }

  async registerReceived(payload: JiraWebhookPayload): Promise<UpsertResult> {
    const now = new Date();
    const fresh: TicketDoc = {
      issueKey: payload.issueKey,
      state: "RECEIVED",
      jiraPayload: payload,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.tickets.insertOne(fresh);
      return { shouldPlan: true, ticket: fresh };
    } catch (err) {
      if (!(err instanceof MongoServerError && err.code === DUPLICATE_KEY)) throw err;
    }

    const reset = await this.tickets.findOneAndUpdate(
      { issueKey: payload.issueKey, state: "FAILED" },
      {
        $set: { state: "RECEIVED", jiraPayload: payload, updatedAt: now },
        $unset: { failureReason: "", failureDetail: "", featurePlan: "", implementReport: "" },
      },
      { returnDocument: "after" },
    );
    if (reset) return { shouldPlan: true, ticket: reset };

    const existing = await this.tickets.findOne({ issueKey: payload.issueKey });
    if (!existing) throw new Error(`Ticket ${payload.issueKey} disappeared during registration`);
    return { shouldPlan: false, ticket: existing };
  }

  async transition(
    issueKey: string,
    from: TicketState | TicketState[],
    to: TicketState,
    patch: Partial<TicketDoc> = {},
  ): Promise<TicketDoc | null> {
    const fromStates = Array.isArray(from) ? from : [from];
    return this.tickets.findOneAndUpdate(
      { issueKey, state: { $in: fromStates } },
      { $set: { ...patch, state: to, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  }

  async approve(issueKey: string, notes: string): Promise<TicketDoc | null> {
    return this.transition(issueKey, "AWAITING_APPROVAL", "IMPLEMENTING", { approvalNotes: notes });
  }

  async markFailed(
    issueKey: string,
    reason: FailureReason,
    detail: string,
    patch: Partial<TicketDoc> = {},
  ): Promise<TicketDoc | null> {
    return this.tickets.findOneAndUpdate(
      { issueKey, state: { $nin: ["DELIVERED"] satisfies TicketState[] } },
      {
        $set: { ...patch, state: "FAILED", failureReason: reason, failureDetail: detail, updatedAt: new Date() },
      },
      { returnDocument: "after" },
    );
  }

  async get(issueKey: string): Promise<TicketDoc | null> {
    return this.tickets.findOne({ issueKey }, { projection: { _id: 0 } });
  }

  async list(state?: TicketState, limit = 100): Promise<TicketDoc[]> {
    const filter = state ? { state } : {};
    return this.tickets
      .find(filter, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
  }

  isActive(ticket: TicketDoc): boolean {
    return ACTIVE_STATES.includes(ticket.state);
  }
}
