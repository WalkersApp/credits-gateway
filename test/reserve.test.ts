import "./setup.js";

import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { creditAccount, getBalance } from "../server/credits/accounts.js";
import { rebalances } from "../server/db.js";
import { requestRebalancesForLowReserves } from "../server/rebalance.js";
import { getReserveStatus } from "../server/reserve.js";
import { createWithdrawal } from "../server/withdrawals/service.js";
import {
  VALID_PREPROD_ADDRESS, disconnect, resetDatabase, stubReserve, stubSettlement, testUser,
} from "./helpers.js";

beforeEach(async () => {
  await resetDatabase();
  stubSettlement();
});
after(disconnect);

async function fundedUser(units: number): Promise<string> {
  const uid = testUser();
  await creditAccount(uid, units, { kind: "deposit", refType: "deposit", refId: "seed", idempotencyKey: `seed:${uid}` });
  return uid;
}

test("available capacity is the vault balance minus what is already committed", async () => {
  const uid = await fundedUser(100_000_000);
  stubReserve({ tada: 500_000_000 });
  stubSettlement({ submit: async () => ({ txHash: "a".repeat(64), ambiguous: false }), confirmations: 0 });

  const w = await createWithdrawal(uid, {
    amount: "20", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS,
  });

  const status = await getReserveStatus();
  const tada = status.assets.find((a) => a.assetId === "tada")!;

  assert.equal(tada.balanceUnits, 500_000_000);
  assert.equal(tada.lockedUnits, w.settlementUnits, "the in-flight settlement is committed reserve");
  assert.equal(tada.availableUnits, 500_000_000 - w.settlementUnits);
});

test("outstanding credits are reported as a liability and compared against capacity", async () => {
  await fundedUser(40_000_000);
  stubReserve({ tada: 100_000_000 });

  const status = await getReserveStatus();

  assert.equal(status.liability.outstandingCreditUnits, 40_000_000);
  assert.equal(status.liability.totalCapacityCreditUnits, 100_000_000);
  assert.equal(status.liability.surplusCreditUnits, 60_000_000);
  assert.equal(status.liability.coverageBps, 25_000, "100 credits of capacity covers 40 of liability 2.5x");
  assert.equal(status.liability.fullyCovered, true);
});

test("a reserve that cannot cover outstanding credits is flagged, not hidden", async () => {
  await fundedUser(200_000_000);
  stubReserve({ tada: 50_000_000 });

  const status = await getReserveStatus();

  assert.equal(status.liability.fullyCovered, false);
  assert.equal(status.liability.surplusCreditUnits, -150_000_000);
  assert.ok(status.warnings.some((w) => w.code === "liability_uncovered" && w.severity === "critical"));
});

test("reserve health crosses low and critical on the free balance, not the gross balance", async () => {
  await fundedUser(1_000_000);

  stubReserve({ tada: 100_000_000, "tusdm-preprod": 500_000_000 });
  assert.equal((await getReserveStatus()).assets[0].health, "healthy");

  stubReserve({ tada: 5_000_000, "tusdm-preprod": 500_000_000 }); // below min (10), above critical (3)
  const low = await getReserveStatus();
  assert.equal(low.assets[0].health, "low");
  assert.ok(low.warnings.some((w) => w.code === "reserve_low"));

  stubReserve({ tada: 1_000_000, "tusdm-preprod": 500_000_000 }); // below critical
  const critical = await getReserveStatus();
  assert.equal(critical.assets[0].health, "critical");
  assert.ok(critical.warnings.some((w) => w.code === "reserve_critical" && w.severity === "critical"));
});

test("a low reserve raises one rebalance request, and does not raise it again while open", async () => {
  await fundedUser(1_000_000);
  // Only tADA is short: every other enabled asset is stubbed healthy so the
  // assertion below is about one shortfall, not about how many assets exist.
  stubReserve({ tada: 5_000_000, "tusdm-preprod": 500_000_000 });

  const first = await requestRebalancesForLowReserves(await getReserveStatus());
  assert.equal(first.length, 1);
  assert.equal(first[0].origin, "auto");
  assert.equal(first[0].status, "planned");
  assert.equal(first[0].provider, "unassigned", "the gateway does not choose a provider");
  assert.equal(first[0].trigger?.health, "low");
  assert.equal(first[0].expectedAmount, "95", "tops up from 5 free to the 100 target");

  const second = await requestRebalancesForLowReserves(await getReserveStatus());
  assert.equal(second.length, 0, "the same shortfall must not queue a second request");
  assert.equal(await rebalances().countDocuments(), 1);
});

test("a healthy reserve raises no rebalance request", async () => {
  await fundedUser(1_000_000);
  stubReserve({ tada: 500_000_000, "tusdm-preprod": 500_000_000 });

  assert.deepEqual(await requestRebalancesForLowReserves(await getReserveStatus()), []);
  assert.equal(await rebalances().countDocuments(), 0);
});

test("a rebalance request does not create settlement capacity by itself", async () => {
  await fundedUser(1_000_000);
  stubReserve({ tada: 5_000_000, "tusdm-preprod": 500_000_000 });

  await requestRebalancesForLowReserves(await getReserveStatus());
  await rebalances().updateMany({}, { $set: { status: "completed", actualAmount: "95" } });

  // Capacity is re-read from the chain, so booking a rebalance completed while
  // nothing actually arrived leaves the reserve exactly as poor as it was.
  const status = await getReserveStatus();
  assert.equal(status.assets[0].availableUnits, 5_000_000);
  assert.equal(status.assets[0].health, "low");
});

test("a native-asset payout is refused when the vault has tokens but not enough ADA", async () => {
  const uid = await fundedUser(100_000_000);
  // Plenty of the settlement token, but the vault is nearly out of ADA — the
  // output carrying the token still needs min-UTxO ADA and a fee.
  stubSettlement({ reserveUnits: 500_000_000, adaReserveLovelace: 100_000 });

  await assert.rejects(
    createWithdrawal(uid, {
      amount: "20", settlementAssetId: "tusdm-preprod", destinationAddress: VALID_PREPROD_ADDRESS,
    }),
    /liquidity is currently below the required amount/i,
  );

  // Refused before anything was locked: the user keeps their credits.
  assert.deepEqual(await getBalance(uid), { availableUnits: 100_000_000, lockedUnits: 0 });
});

test("the same payout succeeds once the vault holds ADA for min-UTxO", async () => {
  const uid = await fundedUser(100_000_000);
  stubSettlement({
    reserveUnits: 500_000_000,
    adaReserveLovelace: 10_000_000,
    submit: async () => ({ txHash: "c".repeat(64), ambiguous: false }),
  });

  const w = await createWithdrawal(uid, {
    amount: "20", settlementAssetId: "tusdm-preprod", destinationAddress: VALID_PREPROD_ADDRESS,
  });
  assert.equal(w.status, "submitted");
  assert.equal(w.settlementAssetId, "tusdm-preprod");
});
