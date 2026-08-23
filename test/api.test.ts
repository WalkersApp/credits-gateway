import "./setup.js";

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { createApp } from "../server/app.js";
import { connect } from "../server/db.js";
import { VALID_PREPROD_ADDRESS, disconnect, resetDatabase, stubChain, stubSettlement } from "./helpers.js";

let server: Server;
let base: string;

before(async () => {
  await connect();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(resetDatabase);

after(async () => {
  server.close();
  await disconnect();
});

/** Tiny cookie jar so a test can act as a signed-in user or as the admin. */
function client() {
  let cookie = "";
  return async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    const res = await fetch(`${base}${path}`, {
      ...rest,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(rest.headers ?? {}) },
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  };
}

test("admin routes reject anonymous and non-admin callers", async () => {
  const anon = client();
  assert.equal((await anon("/api/admin/overview")).status, 403);
  assert.equal((await anon("/api/admin/deposits")).status, 403);
  assert.equal((await anon("/api/admin/withdrawals/x/settle", { method: "POST" })).status, 403);

  const user = client();
  await user("/api/auth/register", { method: "POST", json: { email: "user@example.test", password: "password123" } });
  assert.equal((await user("/api/admin/overview")).status, 403);
});

test("the admin password is required and then grants access", async () => {
  const admin = client();
  assert.equal((await admin("/api/admin/login", { method: "POST", json: { password: "wrong" } })).status, 401);
  assert.equal((await admin("/api/admin/login", { method: "POST", json: { password: process.env.ADMIN_PASSWORD } })).status, 200);
  assert.equal((await admin("/api/admin/overview")).status, 200);
});

test("value-moving endpoints require a session", async () => {
  const anon = client();
  assert.equal((await anon("/api/deposits", { method: "POST", json: { routeId: "sepolia-usdc" } })).status, 401);
  assert.equal((await anon("/api/withdrawals", { method: "POST", json: { amount: "5" } })).status, 401);
});

test("a rate sent by the client is ignored", async () => {
  stubChain("ethereum-sepolia", { found: true, amountUnits: 50_000_000, confirmations: 9 });
  stubSettlement({ submit: async () => ({ txHash: "c".repeat(64), ambiguous: false }) });

  const user = client();
  await user("/api/auth/register", { method: "POST", json: { email: "rates@example.test", password: "password123" } });

  const deposit = await user("/api/deposits", {
    method: "POST",
    json: { routeId: "sepolia-usdc", txHash: `0x${"d".repeat(64)}`, rateBps: 1_000_000, creditsUnits: 999_000_000 },
  });
  assert.equal(deposit.body.status, "credited");
  assert.equal(deposit.body.creditsUnits, 50_000_000);
  assert.equal(deposit.body.rateBps, 10_000);

  const withdrawal = await user("/api/withdrawals", {
    method: "POST",
    json: {
      amount: "10", settlementAssetId: "tada", destinationAddress: VALID_PREPROD_ADDRESS,
      rateBps: 5_000_000, settlementUnits: 999_000_000, feeUnits: 0,
    },
  });
  assert.equal(withdrawal.body.rateBps, 10_000);
  assert.equal(withdrawal.body.settlementUnits, withdrawal.body.netCreditsUnits);
  assert.ok(withdrawal.body.settlementUnits < 10_000_000);
});

test("the public config never exposes a secret", async () => {
  const anon = client();
  const { body } = await anon("/api/gateway/config");
  const serialised = JSON.stringify(body);
  assert.ok(!/ed25519_sk|SESSION_SECRET|ADMIN_PASSWORD|password/i.test(serialised));
  assert.equal(body.network, "cardano-preprod");
});
