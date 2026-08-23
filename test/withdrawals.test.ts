import "./setup.js";

import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { creditAccount, getBalance } from "../server/credits/accounts.js";
import { checkIntegrity } from "../server/credits/integrity.js";
import { withdrawals } from "../server/db.js";
import {
  confirmSettlement, createWithdrawal, quoteWithdrawal, refundWithdrawal, releaseManualReview, settleWithdrawal,
} from "../server/withdrawals/service.js";
import { SettlementRejectedError } from "../server/settlement/cardano.js";
import { MAINNET_ADDRESS, VALID_PREPROD_ADDRESS, disconnect, resetDatabase, stubSettlement, testUser } from "./helpers.js";

beforeEach(resetDatabase);
after(disconnect);

const TX = "b".repeat(64);

async function fundedUser(units = 100_000_000): Promise<string> {
  const uid = testUser();
  await creditAccount(uid, units, { kind: "deposit", refType: "deposit", refId: "seed", idempotencyKey: `seed:${uid}` });
  return uid;
}

test("a withdrawal locks the gross credits and settles the net amount", async () => {
  const uid = await fundedUser();
  const stub = stubSettlement({ submit: async () => ({ txHash: TX, ambiguous: false }) });

  const w = await createWithdrawal(uid, { amount: "20", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS });

  assert.equal(w.status, "submitted");
  assert.equal(w.txHash, TX);
  assert.equal(w.creditsUnits, 20_000_000);
  assert.equal(w.feeUnits, quoteWithdrawal("20", "tada").feeUnits);
  assert.equal(w.settlementUnits, w.netCreditsUnits);
  assert.equal(stub.submissions, 1);
  assert.deepEqual(await getBalance(uid), { availableUnits: 80_000_000, lockedUnits: 20_000_000 });
});

test("locked credits are consumed only once the settlement is confirmed on chain", async () => {
  const uid = await fundedUser();
  stubSettlement({ submit: async () => ({ txHash: TX, ambiguous: false }), confirmations: 2 });

  const w = await createWithdrawal(uid, { amount: "20", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS });
  const confirmed = await confirmSettlement(w.id);

  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.txHash, TX);
  assert.deepEqual(await getBalance(uid), { availableUnits: 80_000_000, lockedUnits: 0 });
  assert.equal((await checkIntegrity()).driftUnits, 0);
});

test("a mainnet destination address is refused server-side", async () => {
  const uid = await fundedUser();
  stubSettlement();
  await assert.rejects(
    createWithdrawal(uid, { amount: "20", settlementAssetId: "tada", destinationAddress: MAINNET_ADDRESS }),
    /mainnet address/,
  );
  assert.equal((await getBalance(uid)).availableUnits, 100_000_000);
});

test("an insufficient reserve blocks the settlement without touching the credits", async () => {
  const uid = await fundedUser();
  stubSettlement({ reserveUnits: 1_000_000 });

  await assert.rejects(
    createWithdrawal(uid, { amount: "50", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS }),
    /liquidity/i,
  );
  assert.deepEqual(await getBalance(uid), { availableUnits: 100_000_000, lockedUnits: 0 });
});

test("a settlement rejected before broadcast releases the locked credits", async () => {
  const uid = await fundedUser();
  stubSettlement({
    submit: async () => { throw new SettlementRejectedError("The node rejected the settlement transaction."); },
  });

  const w = await createWithdrawal(uid, { amount: "20", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS });

  assert.equal(w.status, "refunded");
  assert.match(w.failureReason ?? "", /rejected/i);
  assert.deepEqual(await getBalance(uid), { availableUnits: 100_000_000, lockedUnits: 0 });
  assert.equal((await checkIntegrity()).driftUnits, 0);
});

test("an ambiguous submit goes to manual review and is never refunded automatically", async () => {
  const uid = await fundedUser();
  stubSettlement({ submit: async () => ({ txHash: TX, ambiguous: true }), confirmations: 0 });

  const w = await createWithdrawal(uid, { amount: "20", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS });

  assert.equal(w.status, "manual_review");
  assert.equal(w.txHash, TX);
  assert.deepEqual(await getBalance(uid), { availableUnits: 80_000_000, lockedUnits: 20_000_000 });

  await assert.rejects(refundWithdrawal(w.id), /cannot be refunded/);
  assert.deepEqual(await getBalance(uid), { availableUnits: 80_000_000, lockedUnits: 20_000_000 });
});

test("manual review is only released once an admin confirms the transaction never landed", async () => {
  const uid = await fundedUser();
  const stub = stubSettlement({ submit: async () => ({ txHash: TX, ambiguous: true }), confirmations: 3 });
  const w = await createWithdrawal(uid, { amount: "20", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS });

  // While the chain still shows the transaction, releasing is refused.
  await assert.rejects(releaseManualReview(w.id, "checked"), /on chain/);

  stub.confirmations = 0;
  const released = await releaseManualReview(w.id, "Never reached the chain.");
  assert.equal(released.status, "refunded");
  assert.deepEqual(await getBalance(uid), { availableUnits: 100_000_000, lockedUnits: 0 });
});

test("settling the same withdrawal twice cannot broadcast twice", async () => {
  const uid = await fundedUser();
  const stub = stubSettlement({ submit: async () => ({ txHash: TX, ambiguous: false }) });

  const w = await createWithdrawal(uid, { amount: "20", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS });
  await settleWithdrawal(w.id);
  await settleWithdrawal(w.id);

  assert.equal(stub.submissions, 1);
  assert.deepEqual(await getBalance(uid), { availableUnits: 80_000_000, lockedUnits: 20_000_000 });
});

test("a repeated request with the same idempotency key creates one withdrawal", async () => {
  const uid = await fundedUser();
  stubSettlement({ submit: async () => ({ txHash: TX, ambiguous: false }) });

  const first = await createWithdrawal(uid, {
    amount: "20", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS, requestKey: "req-1",
  });
  const second = await createWithdrawal(uid, {
    amount: "20", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS, requestKey: "req-1",
  });

  assert.equal(second.id, first.id);
  assert.equal(await withdrawals().countDocuments({ userId: uid }), 1);
  assert.deepEqual(await getBalance(uid), { availableUnits: 80_000_000, lockedUnits: 20_000_000 });
});

test("a refund cannot run twice", async () => {
  const uid = await fundedUser();
  stubSettlement({ submit: async () => { throw new SettlementRejectedError("nope"); } });

  const w = await createWithdrawal(uid, { amount: "20", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS });
  assert.equal(w.status, "refunded");

  const again = await refundWithdrawal(w.id);
  assert.equal(again.status, "refunded");
  assert.deepEqual(await getBalance(uid), { availableUnits: 100_000_000, lockedUnits: 0 });
  assert.equal((await checkIntegrity()).driftUnits, 0);
});

test("the quote comes from server configuration, not the request", () => {
  const quote = quoteWithdrawal("20", "tada");
  assert.equal(quote.rateBps, 10_000);
  assert.equal(quote.creditsUnits, 20_000_000);
  assert.equal(quote.netCreditsUnits, quote.creditsUnits - quote.feeUnits);
  assert.throws(() => quoteWithdrawal("20", "not-an-asset"), /not available/);
});
