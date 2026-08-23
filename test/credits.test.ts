import "./setup.js";

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { creditAccount, getBalance, lockCredits, spendLocked, unlockCredits } from "../server/credits/accounts.js";
import { checkIntegrity } from "../server/credits/integrity.js";
import { disconnect, resetDatabase, testUser } from "./helpers.js";

before(resetDatabase);
beforeEach(resetDatabase);
after(disconnect);

const meta = (key: string) => ({ kind: "deposit" as const, refType: "deposit" as const, refId: key, idempotencyKey: key });

test("crediting the same idempotency key twice only issues credits once", async () => {
  const uid = testUser();
  await creditAccount(uid, 5_000_000, meta("deposit:one"));
  await creditAccount(uid, 5_000_000, meta("deposit:one"));
  assert.deepEqual(await getBalance(uid), { availableUnits: 5_000_000, lockedUnits: 0 });
});

test("locking moves credits out of available and cannot overdraw", async () => {
  const uid = testUser();
  await creditAccount(uid, 10_000_000, meta("deposit:two"));
  await lockCredits(uid, 4_000_000, { kind: "withdrawal", refType: "withdrawal", refId: "w1", idempotencyKey: "lock:w1" });
  assert.deepEqual(await getBalance(uid), { availableUnits: 6_000_000, lockedUnits: 4_000_000 });

  await assert.rejects(
    lockCredits(uid, 99_000_000, { kind: "withdrawal", refType: "withdrawal", refId: "w2", idempotencyKey: "lock:w2" }),
    /Insufficient credits/,
  );
});

test("unlock returns credits and spend consumes them", async () => {
  const uid = testUser();
  await creditAccount(uid, 10_000_000, meta("deposit:three"));
  await lockCredits(uid, 6_000_000, { kind: "withdrawal", refType: "withdrawal", refId: "w3", idempotencyKey: "lock:w3" });
  await unlockCredits(uid, 2_000_000, { kind: "refund", refType: "withdrawal", refId: "w3", idempotencyKey: "unlock:w3" });
  await spendLocked(uid, 4_000_000, { kind: "withdrawal", refType: "withdrawal", refId: "w3", idempotencyKey: "spend:w3" });
  assert.deepEqual(await getBalance(uid), { availableUnits: 6_000_000, lockedUnits: 0 });
});

test("a repeated refund cannot pay out twice", async () => {
  const uid = testUser();
  await creditAccount(uid, 3_000_000, meta("deposit:four"));
  await lockCredits(uid, 3_000_000, { kind: "withdrawal", refType: "withdrawal", refId: "w4", idempotencyKey: "lock:w4" });
  const key = { kind: "refund" as const, refType: "withdrawal" as const, refId: "w4", idempotencyKey: "refund:w4" };
  await unlockCredits(uid, 3_000_000, key);
  await unlockCredits(uid, 3_000_000, key);
  assert.deepEqual(await getBalance(uid), { availableUnits: 3_000_000, lockedUnits: 0 });
});

test("the ledger stays balanced against account totals", async () => {
  const a = testUser();
  const b = testUser();
  await creditAccount(a, 7_000_000, meta("deposit:five"));
  await creditAccount(b, 2_000_000, meta("deposit:six"));
  await lockCredits(a, 5_000_000, { kind: "withdrawal", refType: "withdrawal", refId: "w5", idempotencyKey: "lock:w5" });
  await spendLocked(a, 5_000_000, { kind: "withdrawal", refType: "withdrawal", refId: "w5", idempotencyKey: "spend:w5" });

  const report = await checkIntegrity();
  assert.equal(report.driftUnits, 0);
  assert.equal(report.balancesTotalUnits, 4_000_000);
});
