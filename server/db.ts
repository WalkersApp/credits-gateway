import { MongoClient, type Db } from "mongodb";
import { config } from "./config.js";
import type {
  Deposit, LedgerEntry, Rebalance, ReserveStatus, Withdrawal,
} from "../src/shared/types.js";

export interface User {
  _id: string;
  email: string;
  passwordHash: string;
  isAdmin: boolean;
  createdAt: number;
}

export interface CreditAccount {
  _id: string;          // userId
  availableUnits: number;
  lockedUnits: number;
  updatedAt: number;
}

export interface AdminEvent {
  _id: string;
  action: string;
  actor: string;
  refType: string;
  refId: string;
  note: string;
  createdAt: number;
}

export interface Counter {
  _id: string;
  value: number;
}

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connect(): Promise<Db> {
  if (database) return database;
  client = new MongoClient(config.mongoUri, { ignoreUndefined: true });
  await client.connect();
  database = client.db(config.mongoDb);
  await createIndexes(database);
  return database;
}

export async function close(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}

function db(): Db {
  if (!database) throw new Error("Database is not connected yet.");
  return database;
}

export const users = () => db().collection<User>("users");
export const accounts = () => db().collection<CreditAccount>("creditAccounts");
export const ledger = () => db().collection<LedgerEntry & { _id: string }>("creditLedger");
export const deposits = () => db().collection<Deposit & { _id: string }>("deposits");
export const withdrawals = () => db().collection<Withdrawal & { _id: string }>("withdrawals");
export const reserveSnapshots = () => db().collection<ReserveStatus & { _id: string }>("reserveSnapshots");
export const rebalances = () => db().collection<Rebalance & { _id: string }>("rebalances");
export const adminEvents = () => db().collection<AdminEvent>("adminEvents");
export const counters = () => db().collection<Counter>("counters");

/**
 * Uniqueness here is the actual safety mechanism, not an optimisation:
 *  - one credit per on-chain transaction, per route
 *  - one credit per exchange withdrawal reference
 *  - one ledger entry per idempotency key
 * Everything else is a plain lookup index.
 */
async function createIndexes(d: Db): Promise<void> {
  await d.collection("users").createIndex({ email: 1 }, { unique: true });

  await d.collection("deposits").createIndex(
    { network: 1, txHash: 1 },
    { unique: true, partialFilterExpression: { txHash: { $type: "string" } } },
  );
  await d.collection("deposits").createIndex(
    { exchange: 1, reference: 1 },
    { unique: true, partialFilterExpression: { reference: { $type: "string" } } },
  );
  await d.collection("deposits").createIndex({ userId: 1, createdAt: -1 });
  await d.collection("deposits").createIndex({ status: 1, updatedAt: -1 });

  await d.collection("creditLedger").createIndex({ idempotencyKey: 1 }, { unique: true });
  await d.collection("creditLedger").createIndex({ seq: 1 }, { unique: true });
  await d.collection("creditLedger").createIndex({ userId: 1, createdAt: -1 });
  await d.collection("creditLedger").createIndex({ refType: 1, refId: 1 });

  await d.collection("withdrawals").createIndex({ userId: 1, createdAt: -1 });
  await d.collection("withdrawals").createIndex(
    { userId: 1, requestKey: 1 },
    { unique: true, partialFilterExpression: { requestKey: { $type: "string" } } },
  );
  await d.collection("withdrawals").createIndex({ status: 1, updatedAt: -1 });
  await d.collection("withdrawals").createIndex(
    { txHash: 1 },
    { unique: true, partialFilterExpression: { txHash: { $type: "string" } } },
  );

  await d.collection("rebalances").createIndex({ createdAt: -1 });
  await d.collection("adminEvents").createIndex({ createdAt: -1 });
  await d.collection("reserveSnapshots").createIndex({ checkedAt: -1 });
}

/** Monotonic counter used for the ledger sequence. */
export async function nextSeq(name: string): Promise<number> {
  const doc = await counters().findOneAndUpdate(
    { _id: name },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return doc!.value;
}
