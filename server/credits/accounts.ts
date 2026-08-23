// The only place credit balances are ever mutated. Every mutation is a guarded
// update plus exactly one ledger row, and the ledger's unique idempotency key is
// what makes a retried API call harmless.

import { accounts, ledger, nextSeq } from "../db.js";
import { newId } from "../ids.js";
import { GatewayError } from "../errors.js";
import { assertPositiveUnits } from "../money.js";
import type { CreditBalance, LedgerDirection, LedgerEntry, LedgerKind } from "../../src/shared/types.js";

export interface LedgerMeta {
  kind: LedgerKind;
  refType: "deposit" | "withdrawal" | "admin";
  refId: string | null;
  idempotencyKey: string;
}

const DUPLICATE_KEY = 11000;

function isDuplicate(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === DUPLICATE_KEY;
}

export async function getBalance(userId: string): Promise<CreditBalance> {
  const acc = await accounts().findOne({ _id: userId });
  return { availableUnits: acc?.availableUnits ?? 0, lockedUnits: acc?.lockedUnits ?? 0 };
}

async function ensureAccount(userId: string): Promise<void> {
  await accounts().updateOne(
    { _id: userId },
    { $setOnInsert: { availableUnits: 0, lockedUnits: 0, updatedAt: Date.now() } },
    { upsert: true },
  );
}

/**
 * Apply a balance mutation and append its ledger row.
 *
 * If the ledger insert loses the race on the idempotency key, the same
 * operation already ran (or is running), so we undo our balance change and
 * return the current balance instead of applying it twice.
 */
async function record(
  userId: string,
  amountUnits: number,
  direction: LedgerDirection,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  meta: LedgerMeta,
  undo: Record<string, unknown>,
): Promise<CreditBalance> {
  assertPositiveUnits(amountUnits, "credit amount");
  await ensureAccount(userId);

  const after = await accounts().findOneAndUpdate(
    { _id: userId, ...filter },
    { ...update, $set: { updatedAt: Date.now() } },
    { returnDocument: "after" },
  );
  if (!after) {
    // The guard failed. Either this operation already ran — a retried refund
    // has nothing left to unlock — or the balance genuinely is too low.
    if (await ledger().findOne({ idempotencyKey: meta.idempotencyKey })) return getBalance(userId);
    throw new GatewayError("Insufficient credits.", 400, "insufficient_credits");
  }

  const entry: LedgerEntry & { _id: string } = {
    _id: newId(),
    id: "",
    seq: await nextSeq("creditLedger"),
    userId,
    direction,
    amountUnits,
    kind: meta.kind,
    refType: meta.refType,
    refId: meta.refId,
    idempotencyKey: meta.idempotencyKey,
    availableAfterUnits: after.availableUnits,
    lockedAfterUnits: after.lockedUnits,
    createdAt: Date.now(),
  };
  entry.id = entry._id;

  try {
    await ledger().insertOne(entry);
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    await accounts().updateOne({ _id: userId }, { ...undo, $set: { updatedAt: Date.now() } });
    return getBalance(userId);
  }
  return { availableUnits: after.availableUnits, lockedUnits: after.lockedUnits };
}

/** Issue new credits against a validated deposit. */
export function creditAccount(userId: string, units: number, meta: LedgerMeta): Promise<CreditBalance> {
  return record(userId, units, "credit", {},
    { $inc: { availableUnits: units } }, meta,
    { $inc: { availableUnits: -units } });
}

/** Move credits out of `available` while a withdrawal is in flight. */
export function lockCredits(userId: string, units: number, meta: LedgerMeta): Promise<CreditBalance> {
  return record(userId, units, "lock", { availableUnits: { $gte: units } },
    { $inc: { availableUnits: -units, lockedUnits: units } }, meta,
    { $inc: { availableUnits: units, lockedUnits: -units } });
}

/** Return locked credits to the user (withdrawal failed before broadcast). */
export function unlockCredits(userId: string, units: number, meta: LedgerMeta): Promise<CreditBalance> {
  return record(userId, units, "unlock", { lockedUnits: { $gte: units } },
    { $inc: { lockedUnits: -units, availableUnits: units } }, meta,
    { $inc: { lockedUnits: units, availableUnits: -units } });
}

/** Consume locked credits once settlement is on chain. This is the real debit. */
export function spendLocked(userId: string, units: number, meta: LedgerMeta): Promise<CreditBalance> {
  return record(userId, units, "spend", { lockedUnits: { $gte: units } },
    { $inc: { lockedUnits: -units } }, meta,
    { $inc: { lockedUnits: units } });
}

/** Admin correction. Kept separate so it never hides inside a business flow. */
export function adjust(userId: string, units: number, up: boolean, meta: LedgerMeta): Promise<CreditBalance> {
  return up
    ? record(userId, units, "credit", {}, { $inc: { availableUnits: units } }, meta, { $inc: { availableUnits: -units } })
    : record(userId, units, "debit", { availableUnits: { $gte: units } },
        { $inc: { availableUnits: -units } }, meta, { $inc: { availableUnits: units } });
}

export async function recentLedger(userId: string, limit = 50): Promise<LedgerEntry[]> {
  return ledger().find({ userId }).sort({ seq: -1 }).limit(limit).toArray();
}
