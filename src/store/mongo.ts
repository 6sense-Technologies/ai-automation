import { MongoClient, type Db } from "mongodb";

export const COLLECTIONS = {
  tickets: "tickets",
  auditLog: "audit_log",
  webhookDeliveries: "webhook_deliveries",
} as const;

export interface MongoHandle {
  client: MongoClient;
  db: Db;
  close(): Promise<void>;
}

/**
 * Connect and ensure indexes. Safe to point at a shared database: the service
 * only touches its own three collections and index creation is idempotent.
 */
export async function connectMongo(uri: string, dbName: string): Promise<MongoHandle> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  await db.collection(COLLECTIONS.tickets).createIndexes([
    { key: { issueKey: 1 }, unique: true, name: "issueKey_unique" },
    { key: { state: 1, updatedAt: -1 }, name: "state_updatedAt" },
  ]);
  await db.collection(COLLECTIONS.auditLog).createIndexes([
    { key: { issueKey: 1, timestamp: 1 }, name: "issueKey_timestamp" },
  ]);
  await db.collection(COLLECTIONS.webhookDeliveries).createIndexes([
    {
      key: { issueKey: 1, phase: 1, deliveryHash: 1 },
      unique: true,
      name: "delivery_dedupe_unique",
    },
  ]);

  return { client, db, close: () => client.close() };
}
