import type { Db } from "mongodb";
import { COLLECTIONS } from "./mongo.js";

export type PipelinePhase = "analyze" | "fix" | "system";

export interface AuditEntry {
  issueKey: string;
  phase: PipelinePhase;
  event: string;
  detail: string;
  timestamp: Date;
}

/** Append-only audit trail: every pipeline lifecycle event lands here. */
export class AuditLog {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<AuditEntry>(COLLECTIONS.auditLog);
  }

  async record(issueKey: string, phase: PipelinePhase, event: string, detail = ""): Promise<void> {
    await this.collection.insertOne({ issueKey, phase, event, detail, timestamp: new Date() });
  }

  async trail(issueKey: string): Promise<AuditEntry[]> {
    return this.collection
      .find({ issueKey }, { projection: { _id: 0 } })
      .sort({ timestamp: 1 })
      .toArray();
  }
}
