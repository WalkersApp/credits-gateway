// Preprod automated settlement demonstration.
//
//   npm run demo:settlement -- --amount 5
//
// Drives the gateway's real HTTP API end to end, against Cardano preprod:
//
//   fund demo wallet -> on-chain deposit -> deposit validation -> credits issued
//   -> withdrawal request -> credit lock -> settlement queue -> vault signs and
//   submits -> Cardano transaction -> confirmation -> credits consumed
//
// Everything is real: two on-chain preprod transactions, the gateway's own
// validation, and the same code path a user hits in the browser. Nothing is
// mocked or back-dated, and the script asserts the outcome rather than
// announcing success — a failed settlement exits non-zero.
//
// What this DOES NOT demonstrate: production liquidity, treasury operations, or
// any external provider. It proves the settlement execution path on preprod.

import { readFileSync, writeFileSync } from "node:fs";

import { Blockfrost, Koios, Lucid } from "@lucid-evolution/lucid";

import { config } from "../server/config.js";

interface Args {
  base: string;
  amount: string;
  assetId: string;
  email: string;
  password: string;
  userKeyPath: string;
  skipDeposit: boolean;
  out: string | null;
  timeoutMs: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback = "") => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  return {
    base: (get("base", process.env.DEMO_GATEWAY_URL || `http://127.0.0.1:${config.port}`)).replace(/\/$/, ""),
    amount: get("amount", "5"),
    assetId: get("asset", process.env.DEMO_SETTLEMENT_ASSET || "tada"),
    email: get("email", process.env.DEMO_EMAIL || "settlement-demo@wfit.local"),
    password: get("password", process.env.DEMO_PASSWORD || ""),
    userKeyPath: get("user-key", process.env.DEMO_USER_KEY_PATH || "/root/.wfit-gateway/user-demo.preprod.key"),
    skipDeposit: has("skip-deposit"),
    out: get("out", "") || null,
    timeoutMs: Number(get("timeout", "600000")),
  };
}

// --- a tiny cookie-carrying client ------------------------------------------

let cookie = "";

async function api<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const err = parsed as { error?: string; code?: string };
    throw new Error(`${method} ${path} -> ${res.status} ${err.code ?? ""}: ${err.error ?? text.slice(0, 300)}`);
  }
  return parsed as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function step(n: number, title: string): void {
  console.log(`\n[${n}] ${title}`);
}

/** Poll until `done` returns a value, or give up. */
async function until<T>(
  label: string,
  timeoutMs: number,
  intervalMs: number,
  probe: () => Promise<T>,
  done: (value: T) => boolean,
  describe: (value: T) => string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    const value = await probe();
    const line = describe(value);
    if (line !== last) {
      console.log(`    ${line}`);
      last = line;
    }
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label} (last: ${line})`);
    await sleep(intervalMs);
  }
}

// --- types we consume from the API ------------------------------------------

interface Deposit {
  id: string; status: string; txHash: string | null; creditsUnits: number;
  confirmations: number; confirmationsRequired: number; rejectionReason: string | null;
}
interface Withdrawal {
  id: string; status: string; txHash: string | null; confirmations: number;
  creditsUnits: number; feeUnits: number; settlementUnits: number;
  settlementAssetId: string; destinationAddress: string; failureReason: string | null;
  createdAt: number; submittedAt: number | null; confirmedAt: number | null;
}
interface ReserveStatus {
  vaultAddress: string;
  assets: Array<{ assetId: string; balanceUnits: number; availableUnits: number; health: string }>;
  liability: { outstandingCreditUnits: number; totalCapacityCreditUnits: number; coverageBps: number | null };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const started = Date.now();

  if (!args.password) {
    throw new Error(
      "Set a demo account password: --password <value> or DEMO_PASSWORD=<value>. " +
        "It is never written to the repository.",
    );
  }

  console.log("WFIT gateway — preprod automated settlement demonstration");
  console.log(`gateway:  ${args.base}`);
  console.log(`network:  cardano-${config.cardano.network}`);
  console.log(`amount:   ${args.amount} credits`);
  console.log(`settle:   ${args.assetId}`);

  const health = await api<{ ok: boolean; network: string }>(args.base, "GET", "/api/health");
  if (!health.ok) throw new Error("gateway health check failed");
  if (health.network !== `cardano-${config.cardano.network}`) {
    throw new Error(`gateway is on ${health.network}, this script is configured for cardano-${config.cardano.network}`);
  }

  // --- the demo user's own preprod wallet ------------------------------------

  step(1, "Loading the demo user's preprod wallet");
  const provider = config.cardano.blockfrostProjectId
    ? new Blockfrost(config.cardano.blockfrostUrl, config.cardano.blockfrostProjectId)
    : new Koios(config.cardano.koiosUrl, config.cardano.koiosToken || undefined);
  const lucid = await Lucid(provider, config.cardano.network === "preview" ? "Preview" : "Preprod");
  lucid.selectWallet.fromPrivateKey(readFileSync(args.userKeyPath, "utf8").trim());
  const userAddress = await lucid.wallet().address();
  console.log(`    user wallet: ${userAddress}`);

  const reserveBefore = await api<ReserveStatus>(args.base, "GET", "/api/reserve");
  console.log(`    vault:       ${reserveBefore.vaultAddress}`);

  // --- sign in ---------------------------------------------------------------

  step(2, "Signing in to the gateway");
  try {
    await api(args.base, "POST", "/api/auth/register", { email: args.email, password: args.password });
    console.log(`    registered ${args.email}`);
  } catch (registerError) {
    // The expected reason is "this demo account already exists", so sign in
    // instead. If that fails too, the registration error is the informative one
    // — report both rather than only "invalid email or password".
    try {
      await api(args.base, "POST", "/api/auth/login", { email: args.email, password: args.password });
      console.log(`    signed in as ${args.email}`);
    } catch (loginError) {
      throw new Error(
        `could not register (${registerError instanceof Error ? registerError.message : registerError}) ` +
          `or sign in (${loginError instanceof Error ? loginError.message : loginError})`,
      );
    }
  }
  const account = await api<{ balance: { availableUnits: number } }>(args.base, "GET", "/api/account");
  console.log(`    starting balance: ${account.balance.availableUnits / 1e6} credits`);

  // --- deposit ---------------------------------------------------------------

  let deposit: Deposit | null = null;
  if (args.skipDeposit) {
    step(3, "Skipping the deposit (--skip-deposit): settling existing credits");
  } else {
    step(3, "Sending a real preprod deposit to the gateway deposit address");
    const depositAddress = config.cardanoDeposits.address;
    if (!depositAddress) throw new Error("CARDANO_DEPOSIT_ADDRESS is not configured");

    const lovelace = BigInt(Math.round(Number(args.amount) * 1_000_000));
    const tx = await lucid.newTx().pay.ToAddress(depositAddress, { lovelace }).complete();
    const signed = await tx.sign.withWallet().complete();
    const depositTxHash = await signed.submit();
    console.log(`    submitted ${args.amount} tADA -> ${depositAddress}`);
    console.log(`    tx: ${depositTxHash}`);
    console.log(`    ${config.cardano.explorerBase}/transaction/${depositTxHash}`);

    step(4, "Registering the deposit and waiting for the gateway to validate it on chain");
    deposit = await api<Deposit>(args.base, "POST", "/api/deposits", {
      routeId: "cardano-preprod-ada",
      txHash: depositTxHash,
    });
    console.log(`    deposit ${deposit.id} created (status ${deposit.status})`);

    deposit = await until(
      "the deposit to be credited",
      args.timeoutMs,
      15_000,
      () => api<Deposit>(args.base, "POST", `/api/deposits/${deposit!.id}/refresh`),
      (d) => d.status === "credited" || d.status === "rejected" || d.status === "failed",
      (d) => `status ${d.status}, ${d.confirmations}/${d.confirmationsRequired} confirmations`,
    );
    if (deposit.status !== "credited") {
      throw new Error(`deposit ended as ${deposit.status}: ${deposit.rejectionReason ?? "no reason given"}`);
    }
    console.log(`    credited ${deposit.creditsUnits / 1e6} credits`);
  }

  // --- withdrawal ------------------------------------------------------------

  step(5, "Requesting a withdrawal — this is the settlement path under test");
  const quote = await api<{ creditsUnits: number; feeUnits: number; settlementUnits: number }>(
    args.base, "POST", "/api/withdrawals/quote",
    { amount: args.amount, settlementAssetId: args.assetId },
  );
  console.log(`    quote: ${quote.creditsUnits / 1e6} credits - ${quote.feeUnits / 1e6} fee ` +
    `-> ${quote.settlementUnits / 1e6} ${args.assetId}`);

  let withdrawal = await api<Withdrawal>(args.base, "POST", "/api/withdrawals", {
    amount: args.amount,
    settlementAssetId: args.assetId,
    destinationAddress: userAddress,
    requestKey: `demo-${started}`,
  });
  console.log(`    withdrawal ${withdrawal.id} created (status ${withdrawal.status})`);

  step(6, "Waiting for the vault to sign, submit and confirm the settlement");
  withdrawal = await until(
    "the settlement to confirm",
    args.timeoutMs,
    10_000,
    () => api<Withdrawal>(args.base, "GET", `/api/withdrawals/${withdrawal.id}`),
    (w) => w.status === "confirmed" || w.status === "failed" || w.status === "refunded",
    (w) => `status ${w.status}${w.txHash ? `, tx ${w.txHash.slice(0, 16)}…, ${w.confirmations} conf` : ""}` +
      `${w.failureReason ? ` — ${w.failureReason.slice(0, 90)}` : ""}`,
  );

  if (withdrawal.status !== "confirmed") {
    throw new Error(`settlement ended as ${withdrawal.status}: ${withdrawal.failureReason ?? "no reason given"}`);
  }
  if (!withdrawal.txHash) throw new Error("withdrawal confirmed without a transaction hash");

  // --- verify independently --------------------------------------------------

  step(7, "Verifying the settlement transaction on chain, independently of the gateway");
  const koiosRes = await fetch(`${config.cardano.koiosUrl}/tx_status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.cardano.koiosToken ? { authorization: `Bearer ${config.cardano.koiosToken}` } : {}),
    },
    body: JSON.stringify({ _tx_hashes: [withdrawal.txHash] }),
  });
  const koios = (await koiosRes.json()) as Array<{ tx_hash: string; num_confirmations: number | null }>;
  const confirmations = koios[0]?.num_confirmations ?? 0;
  if (confirmations < 1) throw new Error(`Koios does not show ${withdrawal.txHash} on chain`);
  console.log(`    Koios confirms ${withdrawal.txHash} with ${confirmations} confirmations`);

  const reserveAfter = await api<ReserveStatus>(args.base, "GET", "/api/reserve");
  const balanceAfter = await api<{ balance: { availableUnits: number } }>(args.base, "GET", "/api/account");

  // --- evidence record -------------------------------------------------------

  const tadaBefore = reserveBefore.assets.find((a) => a.assetId === "tada");
  const tadaAfter = reserveAfter.assets.find((a) => a.assetId === "tada");
  const settledBefore = reserveBefore.assets.find((a) => a.assetId === args.assetId);
  const settledAfter = reserveAfter.assets.find((a) => a.assetId === args.assetId);

  const evidence = {
    demonstration: "preprod automated settlement demonstration using test liquidity",
    disclaimer:
      "Cardano preprod only, using test liquidity. Proves the gateway's settlement execution path. Not " +
      "production liquidity, not a treasury operation, not production USDM/USDCx settlement, and no external " +
      "provider is involved. Production USDM/USDCx settlement depends on final liquidity, treasury and " +
      "provider setup during the pilot phase.",
    network: `cardano-${config.cardano.network}`,
    gateway: args.base,
    ranAt: new Date(started).toISOString(),
    durationSeconds: Math.round((Date.now() - started) / 1000),
    deposit: deposit
      ? {
          id: deposit.id,
          txHash: deposit.txHash,
          explorerUrl: `${config.cardano.explorerBase}/transaction/${deposit.txHash}`,
          creditsIssued: deposit.creditsUnits / 1e6,
          verification: "on-chain automatic",
        }
      : "skipped (--skip-deposit)",
    settlement: {
      withdrawalId: withdrawal.id,
      creditsLocked: withdrawal.creditsUnits / 1e6,
      fee: withdrawal.feeUnits / 1e6,
      settlementAsset: withdrawal.settlementAssetId,
      amountSettled: withdrawal.settlementUnits / 1e6,
      destinationAddress: withdrawal.destinationAddress,
      txHash: withdrawal.txHash,
      explorerUrl: `${config.cardano.explorerBase}/transaction/${withdrawal.txHash}`,
      confirmationsAtCheck: confirmations,
      submittedAt: withdrawal.submittedAt ? new Date(withdrawal.submittedAt).toISOString() : null,
      confirmedAt: withdrawal.confirmedAt ? new Date(withdrawal.confirmedAt).toISOString() : null,
      secondsRequestToConfirm: withdrawal.confirmedAt
        ? Math.round((withdrawal.confirmedAt - withdrawal.createdAt) / 1000)
        : null,
    },
    vault: {
      address: reserveAfter.vaultAddress,
      explorerUrl: `${config.cardano.explorerBase}/address/${reserveAfter.vaultAddress}`,
      tadaBalanceBefore: (tadaBefore?.balanceUnits ?? 0) / 1e6,
      tadaBalanceAfter: (tadaAfter?.balanceUnits ?? 0) / 1e6,
      settlementAssetBalanceBefore: (settledBefore?.balanceUnits ?? 0) / 1e6,
      settlementAssetBalanceAfter: (settledAfter?.balanceUnits ?? 0) / 1e6,
      healthAfter: settledAfter?.health ?? "unknown",
    },
    credits: {
      userBalanceAfter: balanceAfter.balance.availableUnits / 1e6,
      outstandingLiability: reserveAfter.liability.outstandingCreditUnits / 1e6,
      settlementCapacity: reserveAfter.liability.totalCapacityCreditUnits / 1e6,
      coveragePercent: reserveAfter.liability.coverageBps != null
        ? reserveAfter.liability.coverageBps / 100
        : null,
    },
  };

  console.log("\n─────────────────────────────────────────────");
  console.log("SETTLEMENT CONFIRMED ON CARDANO PREPROD");
  console.log("─────────────────────────────────────────────");
  console.log(JSON.stringify(evidence, null, 2));

  if (args.out) {
    writeFileSync(args.out, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`\nevidence written to ${args.out}`);
  }
}

main().catch((err) => {
  console.error(`\nDEMONSTRATION FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
