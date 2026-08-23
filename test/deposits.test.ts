import "./setup.js";

import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { getBalance } from "../server/credits/accounts.js";
import { approveManualDeposit, createDeposit, rejectManualDeposit } from "../server/deposits/service.js";
import { disconnect, resetDatabase, stubChain, testUser } from "./helpers.js";

beforeEach(resetDatabase);
after(disconnect);

const SEPOLIA_TX = `0x${"a".repeat(64)}`;

test("a confirmed on-chain deposit issues credits exactly once", async () => {
  const uid = testUser();
  stubChain("ethereum-sepolia", { found: true, amountUnits: 25_000_000, confirmations: 6 });

  const deposit = await createDeposit(uid, { routeId: "sepolia-usdc", txHash: SEPOLIA_TX });
  assert.equal(deposit.status, "credited");
  assert.equal(deposit.creditsUnits, 25_000_000);
  assert.deepEqual(await getBalance(uid), { availableUnits: 25_000_000, lockedUnits: 0 });
});

test("submitting the same transaction again returns the original and does not credit twice", async () => {
  const uid = testUser();
  stubChain("ethereum-sepolia", { found: true, amountUnits: 10_000_000, confirmations: 6 });

  const first = await createDeposit(uid, { routeId: "sepolia-usdc", txHash: SEPOLIA_TX });
  const second = await createDeposit(uid, { routeId: "sepolia-usdc", txHash: SEPOLIA_TX.toUpperCase() });

  assert.equal(second.id, first.id);
  assert.equal(second.duplicateSubmissions, 1);
  assert.deepEqual(await getBalance(uid), { availableUnits: 10_000_000, lockedUnits: 0 });
});

test("an unconfirmed deposit issues no credits", async () => {
  const uid = testUser();
  stubChain("ethereum-sepolia", { found: true, amountUnits: 10_000_000, confirmations: 1 });

  const deposit = await createDeposit(uid, { routeId: "sepolia-usdc", txHash: SEPOLIA_TX });
  assert.equal(deposit.status, "confirming");
  assert.equal(deposit.creditsUnits, null);
  assert.equal((await getBalance(uid)).availableUnits, 0);
});

test("a transaction that does not pay the gateway stays pending with a reason", async () => {
  const uid = testUser();
  stubChain("ethereum-sepolia", { found: false, amountUnits: 0, confirmations: 0, reason: "That transaction contains no USDC transfer to the gateway's Sepolia deposit address." });

  const deposit = await createDeposit(uid, { routeId: "sepolia-usdc", txHash: SEPOLIA_TX });
  assert.equal(deposit.status, "pending");
  assert.match(deposit.rejectionReason ?? "", /no USDC transfer/);
  assert.equal((await getBalance(uid)).availableUnits, 0);
});

test("an amount below the route minimum is rejected", async () => {
  const uid = testUser();
  stubChain("ethereum-sepolia", { found: true, amountUnits: 1_000, confirmations: 6 });

  const deposit = await createDeposit(uid, { routeId: "sepolia-usdc", txHash: SEPOLIA_TX });
  assert.equal(deposit.status, "rejected");
  assert.equal((await getBalance(uid)).availableUnits, 0);
});

test("an exchange deposit issues nothing until an admin approves it, and approval is idempotent", async () => {
  const uid = testUser();
  const deposit = await createDeposit(uid, {
    routeId: "cex-manual", exchange: "Binance", reference: "WD-99887766", amount: "40",
  });
  assert.equal(deposit.status, "pending");
  assert.equal((await getBalance(uid)).availableUnits, 0);

  const approved = await approveManualDeposit(deposit.id);
  assert.equal(approved.status, "credited");
  assert.equal(approved.creditsUnits, 40_000_000);

  await approveManualDeposit(deposit.id);
  await approveManualDeposit(deposit.id);
  assert.deepEqual(await getBalance(uid), { availableUnits: 40_000_000, lockedUnits: 0 });
});

test("a rejected exchange deposit issues no credits and cannot then be approved", async () => {
  const uid = testUser();
  const deposit = await createDeposit(uid, {
    routeId: "cex-manual", exchange: "Kraken", reference: "WD-11223344", amount: "15",
  });

  const rejected = await rejectManualDeposit(deposit.id, "No matching withdrawal on the exchange.");
  assert.equal(rejected.status, "rejected");
  assert.equal((await getBalance(uid)).availableUnits, 0);

  await assert.rejects(approveManualDeposit(deposit.id), /already rejected/i);
  assert.equal((await getBalance(uid)).availableUnits, 0);
});

test("the same exchange reference cannot be submitted twice", async () => {
  const uid = testUser();
  const first = await createDeposit(uid, { routeId: "cex-manual", exchange: "Bybit", reference: "WD-5555", amount: "20" });
  const second = await createDeposit(uid, { routeId: "cex-manual", exchange: "Bybit", reference: "WD-5555", amount: "20" });
  assert.equal(second.id, first.id);

  await approveManualDeposit(first.id);
  assert.equal((await getBalance(uid)).availableUnits, 20_000_000);
});
