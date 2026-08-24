import { join } from "node:path";

import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";

import { config } from "./config.js";
import { CONVERSION, CONVERSION_EXAMPLE, SETTLEMENT_DIRECTION } from "./conversion.js";
import { CUSTODY_SUMMARY, custodyChain } from "./custody.js";
import {
  DEPOSIT_LIFECYCLE, DEPOSIT_OUTCOMES, REFUND_POLICY, WITHDRAWAL_LIFECYCLE, WITHDRAWAL_OUTCOMES,
} from "./failureModes.js";
import {
  COOKIE_NAME, authenticate, authenticateAdmin, issueToken, loadSession, registerUser,
  requireAdmin, requireUser, setSessionCookie,
} from "./auth.js";
import { getBalance, recentLedger } from "./credits/accounts.js";
import { checkIntegrity } from "./credits/integrity.js";
import { adminEvents, deposits as depositsCollection, users, withdrawals as withdrawalsCollection } from "./db.js";
import {
  approveManualDeposit, createDeposit, listDeposits, rejectManualDeposit, validateDeposit,
} from "./deposits/service.js";
import { GatewayError } from "./errors.js";
import { FUNDING_ROUTES } from "./fundingRoutes.js";
import { newId } from "./ids.js";
import { listRebalances, recordRebalance, updateRebalance } from "./rebalance.js";
import { rateLimit } from "./rateLimit.js";
import { getReserveStatus, snapshotReserve } from "./reserve.js";
import { SETTLEMENT_ASSETS, SETTLEMENT_RATE_BPS, SETTLEMENT_TARGETS, explorerAddressUrl, explorerTxUrl } from "./settlement/assets.js";
import {
  confirmSettlement, createWithdrawal, listWithdrawals, quoteWithdrawal, releaseManualReview,
  settleWithdrawal,
} from "./withdrawals/service.js";

/** Express 4 does not forward async rejections, so every handler goes through this. */
const route = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use(loadSession);

  // --- public config ---------------------------------------------------------

  app.get("/api/health", route(async (_req, res) => {
    res.json({ ok: true, network: `cardano-${config.cardano.network}`, time: Date.now() });
  }));

  app.get("/api/gateway/config", route(async (_req, res) => {
    res.json({
      network: `cardano-${config.cardano.network}`,
      explorerBase: config.cardano.explorerBase,
      chainProvider: config.cardano.blockfrostProjectId
        ? "Blockfrost preprod for building and submitting, Koios preprod for reads and as a confirmation fallback"
        : "Koios preprod for reads, building and submitting",
      sepoliaExplorerBase: config.sepolia.explorerBase,
      vaultAddress: config.cardano.vaultAddress,
      routes: FUNDING_ROUTES,
      settlementAssets: SETTLEMENT_ASSETS.map((a) => ({ ...a, rateBps: SETTLEMENT_RATE_BPS[a.id] ?? 10_000 })),
      settlementTargets: SETTLEMENT_TARGETS,
      conversion: CONVERSION,
      conversionExample: CONVERSION_EXAMPLE,
      settlementDirection: SETTLEMENT_DIRECTION,
      custody: { summary: CUSTODY_SUMMARY, chain: custodyChain() },
      depositOutcomes: DEPOSIT_OUTCOMES,
      withdrawalOutcomes: WITHDRAWAL_OUTCOMES,
      depositLifecycle: DEPOSIT_LIFECYCLE,
      withdrawalLifecycle: WITHDRAWAL_LIFECYCLE,
      refundPolicy: REFUND_POLICY,
      exchanges: config.cexDeposits.exchanges,
      fees: {
        withdrawalFlatUnits: config.fees.withdrawalFlatUnits,
        withdrawalBps: config.fees.withdrawalBps,
        depositFlatUnits: config.fees.depositFlatUnits,
        depositBps: config.fees.depositBps,
        minWithdrawalUnits: config.fees.minWithdrawalUnits,
        maxWithdrawalUnits: config.fees.maxWithdrawalUnits,
      },
    });
  }));

  // --- auth ------------------------------------------------------------------

  app.post("/api/auth/register", rateLimit(10, 60_000), route(async (req, res) => {
    const user = await registerUser(String(req.body?.email ?? ""), String(req.body?.password ?? ""));
    setSessionCookie(res, issueToken({ sub: user._id, role: "user", email: user.email }));
    res.json({ email: user.email });
  }));

  app.post("/api/auth/login", rateLimit(10, 60_000), route(async (req, res) => {
    const user = await authenticate(String(req.body?.email ?? ""), String(req.body?.password ?? ""));
    setSessionCookie(res, issueToken({ sub: user._id, role: user.isAdmin ? "admin" : "user", email: user.email }));
    res.json({ email: user.email });
  }));

  app.post("/api/auth/logout", route(async (_req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
  }));

  app.post("/api/admin/login", rateLimit(5, 60_000), route(async (req, res) => {
    authenticateAdmin(String(req.body?.password ?? ""));
    setSessionCookie(res, issueToken({ sub: "admin", role: "admin", email: "admin" }));
    res.json({ ok: true });
  }));

  // --- account ---------------------------------------------------------------

  app.get("/api/account", route(async (req, res) => {
    if (!req.session) return res.json({ signedIn: false });
    const balance = await getBalance(req.session.sub);
    res.json({ signedIn: true, email: req.session.email, role: req.session.role, balance });
  }));

  app.get("/api/transactions", requireUser, route(async (req, res) => {
    const userId = req.session!.sub;
    const [deps, wds, entries] = await Promise.all([
      listDeposits({ userId }, 25),
      listWithdrawals({ userId }, 25),
      recentLedger(userId, 50),
    ]);
    res.json({ deposits: deps, withdrawals: wds, ledger: entries });
  }));

  // --- deposits --------------------------------------------------------------

  app.post("/api/deposits", requireUser, rateLimit(20, 60_000), route(async (req, res) => {
    const deposit = await createDeposit(req.session!.sub, {
      routeId: String(req.body?.routeId ?? ""),
      txHash: req.body?.txHash ? String(req.body.txHash) : undefined,
      amount: req.body?.amount ? String(req.body.amount) : undefined,
      exchange: req.body?.exchange ? String(req.body.exchange) : undefined,
      reference: req.body?.reference ? String(req.body.reference) : undefined,
    });
    res.json(deposit);
  }));

  app.get("/api/deposits", requireUser, route(async (req, res) => {
    res.json(await listDeposits({ userId: req.session!.sub }, 50));
  }));

  app.get("/api/deposits/:id", requireUser, route(async (req, res) => {
    const deposit = await depositsCollection().findOne({ _id: req.params.id, userId: req.session!.sub });
    if (!deposit) throw new GatewayError("Deposit not found.", 404, "not_found");
    res.json(deposit);
  }));

  app.post("/api/deposits/:id/refresh", requireUser, rateLimit(30, 60_000), route(async (req, res) => {
    const owned = await depositsCollection().findOne({ _id: req.params.id, userId: req.session!.sub });
    if (!owned) throw new GatewayError("Deposit not found.", 404, "not_found");
    res.json(await validateDeposit(req.params.id));
  }));

  // --- withdrawals -----------------------------------------------------------

  app.post("/api/withdrawals/quote", requireUser, rateLimit(60, 60_000), route(async (req, res) => {
    res.json(quoteWithdrawal(String(req.body?.amount ?? ""), String(req.body?.settlementAssetId ?? "")));
  }));

  app.post("/api/withdrawals", requireUser, rateLimit(10, 60_000), route(async (req, res) => {
    const withdrawal = await createWithdrawal(req.session!.sub, {
      amount: String(req.body?.amount ?? ""),
      settlementAssetId: String(req.body?.settlementAssetId ?? ""),
      destinationAddress: String(req.body?.destinationAddress ?? ""),
      requestKey: req.get("idempotency-key") ?? (req.body?.requestKey ? String(req.body.requestKey) : null),
    });
    res.json(withdrawal);
  }));

  app.get("/api/withdrawals", requireUser, route(async (req, res) => {
    res.json(await listWithdrawals({ userId: req.session!.sub }, 50));
  }));

  app.get("/api/withdrawals/:id", requireUser, route(async (req, res) => {
    const w = await withdrawalsCollection().findOne({ _id: req.params.id, userId: req.session!.sub });
    if (!w) throw new GatewayError("Withdrawal not found.", 404, "not_found");
    res.json(w);
  }));

  // --- reserve + evidence (public: this is what a reviewer came to see) -------

  app.get("/api/reserve", route(async (_req, res) => {
    res.json(await getReserveStatus());
  }));

  app.get("/api/evidence", route(async (_req, res) => {
    const [credited, settled, rejected, refunded, review, duplicates, integrity, reserve] = await Promise.all([
      listDeposits({ status: "credited" }, 10),
      listWithdrawals({ status: "confirmed" }, 10),
      listDeposits({ status: { $in: ["rejected", "failed"] } }, 10),
      listWithdrawals({ status: "refunded" }, 10),
      listWithdrawals({ status: "manual_review" }, 10),
      listDeposits({ duplicateSubmissions: { $gt: 0 } }, 10),
      checkIntegrity(),
      getReserveStatus().catch(() => null),
    ]);
    res.json({
      environment: {
        network: `cardano-${config.cardano.network}`,
        gatewayUrl: config.publicUrl,
        vaultAddress: config.cardano.vaultAddress,
        vaultExplorerUrl: config.cardano.vaultAddress ? explorerAddressUrl(config.cardano.vaultAddress) : null,
        cardanoDepositAddress: config.cardanoDeposits.address || null,
        sepoliaDepositAddress: config.sepolia.depositAddress || null,
        chainAccess: config.cardano.blockfrostProjectId ? "Blockfrost preprod (submit), Koios preprod (reads)" : "Koios preprod",
        checkedAt: Date.now(),
      },
      creditedDeposits: credited.map((d) => ({
        ...redactDeposit(d),
        explorerUrl: d.txHash ? (d.network === "ethereum-sepolia" ? `${config.sepolia.explorerBase}/tx/${d.txHash}` : explorerTxUrl(d.txHash)) : null,
      })),
      settledWithdrawals: settled.map((w) => ({ ...redactWithdrawal(w), explorerUrl: w.txHash ? explorerTxUrl(w.txHash) : null })),
      rejectedDeposits: rejected.map(redactDeposit),
      refundedWithdrawals: refunded.map(redactWithdrawal),
      manualReviewWithdrawals: review.map(redactWithdrawal),
      duplicateSubmissions: duplicates.map(redactDeposit),
      integrity,
      reserve,
      depositOutcomes: DEPOSIT_OUTCOMES,
      withdrawalOutcomes: WITHDRAWAL_OUTCOMES,
      depositLifecycle: DEPOSIT_LIFECYCLE,
      withdrawalLifecycle: WITHDRAWAL_LIFECYCLE,
      refundPolicy: REFUND_POLICY,
      settlementDirection: SETTLEMENT_DIRECTION,
    });
  }));

  // --- admin -----------------------------------------------------------------

  app.get("/api/admin/overview", requireAdmin, route(async (_req, res) => {
    const [depositCounts, withdrawalCounts, userCount, integrity, reserve] = await Promise.all([
      countByStatus(depositsCollection()),
      countByStatus(withdrawalsCollection()),
      users().countDocuments(),
      checkIntegrity(),
      getReserveStatus().catch((err) => ({ error: String(err?.message ?? err) })),
    ]);
    res.json({ deposits: depositCounts, withdrawals: withdrawalCounts, users: userCount, integrity, reserve });
  }));

  app.get("/api/admin/deposits", requireAdmin, route(async (req, res) => {
    const filter = req.query.status ? { status: String(req.query.status) } : {};
    res.json(await listDeposits(filter, 100));
  }));

  app.post("/api/admin/deposits/:id/approve", requireAdmin, route(async (req, res) => {
    const deposit = await approveManualDeposit(req.params.id);
    await logAdmin(req, "deposit.approve", "deposit", req.params.id, "");
    res.json(deposit);
  }));

  app.post("/api/admin/deposits/:id/reject", requireAdmin, route(async (req, res) => {
    const reason = String(req.body?.reason ?? "");
    const deposit = await rejectManualDeposit(req.params.id, reason);
    await logAdmin(req, "deposit.reject", "deposit", req.params.id, reason);
    res.json(deposit);
  }));

  app.get("/api/admin/withdrawals", requireAdmin, route(async (req, res) => {
    const filter = req.query.status ? { status: String(req.query.status) } : {};
    res.json(await listWithdrawals(filter, 100));
  }));

  app.post("/api/admin/withdrawals/:id/settle", requireAdmin, route(async (req, res) => {
    const w = await settleWithdrawal(req.params.id);
    await logAdmin(req, "withdrawal.settle", "withdrawal", req.params.id, "");
    res.json(w);
  }));

  app.post("/api/admin/withdrawals/:id/confirm", requireAdmin, route(async (req, res) => {
    res.json(await confirmSettlement(req.params.id));
  }));

  app.post("/api/admin/withdrawals/:id/release", requireAdmin, route(async (req, res) => {
    const note = String(req.body?.note ?? "");
    const w = await releaseManualReview(req.params.id, note);
    await logAdmin(req, "withdrawal.release", "withdrawal", req.params.id, note);
    res.json(w);
  }));

  app.get("/api/admin/integrity", requireAdmin, route(async (_req, res) => {
    res.json(await checkIntegrity());
  }));

  app.get("/api/admin/reserve", requireAdmin, route(async (_req, res) => {
    res.json(await getReserveStatus());
  }));

  app.post("/api/admin/reserve/snapshot", requireAdmin, route(async (_req, res) => {
    res.json(await snapshotReserve());
  }));

  app.get("/api/admin/rebalances", requireAdmin, route(async (_req, res) => {
    res.json(await listRebalances());
  }));

  app.post("/api/admin/rebalances", requireAdmin, route(async (req, res) => {
    const rebalance = await recordRebalance(req.body ?? {});
    await logAdmin(req, "rebalance.create", "rebalance", rebalance.id, rebalance.provider);
    res.json(rebalance);
  }));

  app.patch("/api/admin/rebalances/:id", requireAdmin, route(async (req, res) => {
    const rebalance = await updateRebalance(req.params.id, req.body ?? {});
    await logAdmin(req, "rebalance.update", "rebalance", req.params.id, rebalance.status);
    res.json(rebalance);
  }));

  app.get("/api/admin/events", requireAdmin, route(async (_req, res) => {
    res.json(await adminEvents().find({}).sort({ createdAt: -1 }).limit(100).toArray());
  }));

  // --- static client ---------------------------------------------------------

  // Resolved from the working directory so the same code works under tsx in
  // development and from the bundled CJS build in production.
  const clientDir = process.env.CLIENT_DIR || join(process.cwd(), "dist", "client");
  app.use(express.static(clientDir, { index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(clientDir, "index.html")));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof GatewayError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if (err instanceof Error && err.name === "AmountError") {
      return res.status(400).json({ error: err.message, code: "bad_amount" });
    }
    console.error("[api]", err);
    res.status(500).json({ error: "Something went wrong. Nothing was changed.", code: "internal" });
  });

  return app;
}

async function countByStatus(collection: { aggregate: Function }): Promise<Record<string, number>> {
  const rows = (await (collection as any)
    .aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }])
    .toArray()) as Array<{ _id: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

async function logAdmin(req: Request, action: string, refType: string, refId: string, note: string): Promise<void> {
  await adminEvents().insertOne({
    _id: newId(),
    action,
    actor: req.session?.email ?? "admin",
    refType,
    refId,
    note,
    createdAt: Date.now(),
  });
}

/** The evidence page is public, so it shows the transaction facts and not who made them. */
function redactDeposit<T extends { userId: string }>(d: T) {
  const { userId, ...rest } = d;
  return { ...rest, account: `user-${userId.slice(0, 8)}` };
}

function redactWithdrawal<T extends { userId: string }>(w: T) {
  const { userId, ...rest } = w;
  return { ...rest, account: `user-${userId.slice(0, 8)}` };
}
