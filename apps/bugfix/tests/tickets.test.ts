import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectMongo, type MongoHandle } from "@ai-auto/mongo";
import { deliveryHash, TicketStore } from "../src/store/tickets.js";
import type { JiraWebhookPayload } from "../src/schemas/webhook.js";

let mongod: MongoMemoryServer;
let handle: MongoHandle;
let store: TicketStore;

const payload: JiraWebhookPayload = {
  phase: "analyze",
  issueKey: "PROJ-1",
  summary: "Login fails",
  description: "500 on empty password",
  issueType: "Bug",
  priority: "High",
  reporter: "alice",
  assignee: "bob",
  components: ["backend"],
  labels: [],
  attachments: [],
  reproductionSteps: "",
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  handle = await connectMongo(mongod.getUri(), "pipeline_test");
  store = new TicketStore(handle.db);
}, 120_000);

afterAll(async () => {
  await handle.close();
  await mongod.stop();
});

beforeEach(async () => {
  await handle.db.collection("tickets").deleteMany({});
  await handle.db.collection("webhook_deliveries").deleteMany({});
});

describe("webhook delivery dedupe", () => {
  it("accepts the first delivery and drops exact duplicates", async () => {
    const hash = deliveryHash(JSON.stringify(payload));
    expect(await store.recordDelivery("PROJ-1", "analyze", hash)).toBe(true);
    expect(await store.recordDelivery("PROJ-1", "analyze", hash)).toBe(false);
  });

  it("treats a different body as a new delivery", async () => {
    expect(await store.recordDelivery("PROJ-1", "analyze", deliveryHash("a"))).toBe(true);
    expect(await store.recordDelivery("PROJ-1", "analyze", deliveryHash("b"))).toBe(true);
  });
});

describe("registerReceived idempotency", () => {
  it("creates a new ticket in RECEIVED", async () => {
    const result = await store.registerReceived(payload);
    expect(result.shouldAnalyze).toBe(true);
    expect(result.ticket.state).toBe("RECEIVED");
  });

  it("does not restart work for a ticket already in progress", async () => {
    await store.registerReceived(payload);
    await store.transition("PROJ-1", "RECEIVED", "ANALYZING");
    const again = await store.registerReceived(payload);
    expect(again.shouldAnalyze).toBe(false);
    expect(again.ticket.state).toBe("ANALYZING");
  });

  it("resets a FAILED ticket back to RECEIVED on re-trigger", async () => {
    await store.registerReceived(payload);
    await store.markFailed("PROJ-1", "agent_run_error", "boom");
    const again = await store.registerReceived(payload);
    expect(again.shouldAnalyze).toBe(true);
    expect(again.ticket.state).toBe("RECEIVED");
    expect(again.ticket.failureReason).toBeUndefined();
  });
});

describe("state transitions and approval gate", () => {
  it("transitions only from the expected state", async () => {
    await store.registerReceived(payload);
    expect(await store.transition("PROJ-1", "RECEIVED", "ANALYZING")).not.toBeNull();
    // Second identical transition loses the precondition.
    expect(await store.transition("PROJ-1", "RECEIVED", "ANALYZING")).toBeNull();
  });

  it("approve succeeds exactly once (double-call returns null)", async () => {
    await store.registerReceived(payload);
    await store.transition("PROJ-1", "RECEIVED", "ANALYZING");
    await store.transition("PROJ-1", "ANALYZING", "AWAITING_APPROVAL");

    const first = await store.approve("PROJ-1", "looks good");
    expect(first?.state).toBe("FIXING");
    expect(first?.approvalNotes).toBe("looks good");

    const second = await store.approve("PROJ-1", "again");
    expect(second).toBeNull();
  });

  it("approve on an unknown ticket returns null", async () => {
    expect(await store.approve("PROJ-404", "")).toBeNull();
  });
});
