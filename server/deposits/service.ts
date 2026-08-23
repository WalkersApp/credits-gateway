// Deposit lifecycle: pending -> confirming -> confirmed -> credited, or
// rejected/failed. Credits are issued in exactly one place (creditDeposit) and
// exactly once, because the ledger key `deposit:<id>` is unique.

import { config } from "../config.js";
import { deposits } from "../db.js";
import { GatewayError, badRequest, conflict, notFound } from "../errors.js";
import { getRoute } from "../fundingRoutes.js";
import { newId } from "../ids.js";
import { assetUnitsToCredits, feeUnits, parseUnits } from "../money.js";
import { creditAccount } from "../credits/accounts.js";
import { inspectCardanoDeposit, type OnChainDeposit } from "./cardano.js";
import { inspectSepoliaUsdcDeposit } from "./sepolia.js";
import type { Deposit } from "../../src/shared/types.js";

export interface CreateDepositInput {
  routeId: string;
  txHash?: string;
  amount?: string;      // what the user says they sent, in whole tokens
  exchange?: string;
  reference?: string;   // exchange withdrawal id
}

const DUPLICATE_KEY = 11000;

function normaliseTxHash(routeNetwork: string, txHash: string): string {
  const raw = txHash.trim();
  if (routeNetwork === "ethereum-sepolia") {
    if (!/^0x[0-9a-f]{64}$/i.test(raw)) throw badRequest("Enter a valid Ethereum transaction hash.", "bad_tx_hash");
    return raw.toLowerCase();
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw badRequest("Enter a valid Cardano transaction hash.", "bad_tx_hash");
  return raw.toLowerCase();
}

export async function createDeposit(userId: string, input: CreateDepositInput): Promise<Deposit> {
  const route = getRoute(input.routeId);
  if (!route) throw badRequest("Unknown funding route.", "unknown_route");
  if (!route.enabled) throw badRequest(`${route.networkLabel} ${route.asset} funding is not enabled.`, "route_disabled");

  const now = Date.now();
  const base: Deposit = {
    id: newId(),
    userId,
    routeId: route.id,
    network: route.network,
    asset: route.asset,
    status: "pending",
    declaredUnits: null,
    observedUnits: null,
    creditsUnits: null,
    rateBps: route.rateBps,
    feeUnits: 0,
    txHash: null,
    reference: null,
    exchange: null,
    confirmations: 0,
    confirmationsRequired: route.confirmationsRequired,
    verification: route.verification,
    rejectionReason: null,
    duplicateSubmissions: 0,
    createdAt: now,
    updatedAt: now,
    creditedAt: null,
  };

  if (route.verification === "onchain_automatic") {
    if (!input.txHash) throw badRequest("Paste the transaction hash of your deposit.", "missing_tx_hash");
    base.txHash = normaliseTxHash(route.network, input.txHash);
    if (input.amount) base.declaredUnits = parseUnits(input.amount, route.assetDecimals);
  } else {
    if (!input.exchange || !config.cexDeposits.exchanges.includes(input.exchange)) {
      throw badRequest("Choose one of the supported exchanges.", "bad_exchange");
    }
    if (!input.reference || input.reference.trim().length < 4) {
      throw badRequest("Enter the exchange's withdrawal id or transaction hash.", "missing_reference");
    }
    if (!input.amount) throw badRequest("Enter the amount you withdrew.", "missing_amount");
    base.exchange = input.exchange;
    base.reference = input.reference.trim();
    base.declaredUnits = parseUnits(input.amount, route.assetDecimals);
    if (base.declaredUnits < route.minUnits) {
      throw badRequest(`The minimum for this route is ${route.minUnits / 10 ** route.assetDecimals} ${route.asset}.`, "below_minimum");
    }
  }

  try {
    await deposits().insertOne({ _id: base.id, ...base });
  } catch (err) {
    if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
    // The unique index already rejected this exact transaction / exchange
    // reference. Hand back the original record rather than creating a second one.
    const existing = base.txHash
      ? await deposits().findOne({ network: base.network, txHash: base.txHash })
      : await deposits().findOne({ exchange: base.exchange, reference: base.reference });
    if (!existing) throw err;
    if (existing.userId !== userId) {
      throw conflict("That transaction has already been submitted by another account.", "already_claimed");
    }
    await deposits().updateOne({ _id: existing._id }, { $inc: { duplicateSubmissions: 1 } });
    return (await deposits().findOne({ _id: existing._id }))!;
  }

  if (route.verification === "onchain_automatic") {
    return validateDeposit(base.id).catch(() => base);
  }
  return base;
}

type Inspector = (txHash: string, assetUnit: string) => Promise<OnChainDeposit>;

/** One chain reader per network. Tests replace these; nothing else does. */
const inspectors: Record<string, Inspector> = {
  "ethereum-sepolia": (txHash) => inspectSepoliaUsdcDeposit(txHash),
  "cardano-preprod": (txHash, assetUnit) => inspectCardanoDeposit(txHash, assetUnit),
};

export function setDepositInspector(network: string, inspector: Inspector): void {
  inspectors[network] = inspector;
}

async function inspect(deposit: Deposit): Promise<OnChainDeposit> {
  const route = getRoute(deposit.routeId);
  if (!route) return { found: false, amountUnits: 0, confirmations: 0, reason: "Unknown funding route." };
  const inspector = inspectors[route.network];
  if (!inspector) return { found: false, amountUnits: 0, confirmations: 0, reason: "No chain reader for this network." };
  return inspector(deposit.txHash!, route.contract || "lovelace");
}

/**
 * Re-check an on-chain deposit and move it along. Safe to call repeatedly: the
 * terminal states return immediately and crediting is idempotent.
 */
export async function validateDeposit(depositId: string): Promise<Deposit> {
  const deposit = await deposits().findOne({ _id: depositId });
  if (!deposit) throw notFound("Deposit not found.");
  if (deposit.status === "credited" || deposit.status === "rejected" || deposit.status === "failed") return deposit;
  if (deposit.verification === "manual_admin") return deposit;

  const route = getRoute(deposit.routeId)!;
  const result = await inspect(deposit);

  if (!result.found) {
    await deposits().updateOne(
      { _id: deposit._id },
      { $set: { rejectionReason: result.reason ?? null, updatedAt: Date.now() } },
    );
    return (await deposits().findOne({ _id: deposit._id }))!;
  }

  if (result.amountUnits < route.minUnits) {
    await deposits().updateOne(
      { _id: deposit._id, status: { $nin: ["credited"] } },
      {
        $set: {
          status: "rejected",
          observedUnits: result.amountUnits,
          rejectionReason: `Below the ${route.minUnits / 10 ** route.assetDecimals} ${route.asset} minimum for this route.`,
          updatedAt: Date.now(),
        },
      },
    );
    return (await deposits().findOne({ _id: deposit._id }))!;
  }

  if (result.confirmations < route.confirmationsRequired) {
    await deposits().updateOne(
      { _id: deposit._id, status: { $in: ["pending", "confirming"] } },
      {
        $set: {
          status: "confirming",
          observedUnits: result.amountUnits,
          confirmations: result.confirmations,
          rejectionReason: null,
          updatedAt: Date.now(),
        },
      },
    );
    return (await deposits().findOne({ _id: deposit._id }))!;
  }

  await deposits().updateOne(
    { _id: deposit._id, status: { $in: ["pending", "confirming", "confirmed"] } },
    {
      $set: {
        status: "confirmed",
        observedUnits: result.amountUnits,
        confirmations: result.confirmations,
        rejectionReason: null,
        updatedAt: Date.now(),
      },
    },
  );
  return creditDeposit(depositId);
}

/**
 * Issue credits for a confirmed deposit. The unique ledger key is what makes a
 * double call harmless — the second one lands on the same key, the balance
 * mutation is undone, and the deposit is already `credited`.
 */
export async function creditDeposit(depositId: string): Promise<Deposit> {
  const deposit = await deposits().findOne({ _id: depositId });
  if (!deposit) throw notFound("Deposit not found.");
  if (deposit.status === "credited") return deposit;
  if (deposit.status !== "confirmed") {
    throw new GatewayError("Only a confirmed deposit can be credited.", 409, "not_confirmed");
  }
  const route = getRoute(deposit.routeId);
  if (!route) throw new GatewayError("Unknown funding route.", 409, "unknown_route");

  const observed = deposit.observedUnits ?? 0;
  const gross = assetUnitsToCredits(observed, route.assetDecimals, route.rateBps);
  const fee = feeUnits(gross, config.fees.depositFlatUnits, config.fees.depositBps);
  const credits = gross - fee;
  if (credits <= 0) {
    await deposits().updateOne(
      { _id: deposit._id, status: "confirmed" },
      { $set: { status: "rejected", rejectionReason: "Amount is smaller than the deposit fee.", updatedAt: Date.now() } },
    );
    return (await deposits().findOne({ _id: deposit._id }))!;
  }

  await creditAccount(deposit.userId, credits, {
    kind: "deposit",
    refType: "deposit",
    refId: deposit._id,
    idempotencyKey: `deposit:${deposit._id}`,
  });

  await deposits().updateOne(
    { _id: deposit._id, status: "confirmed" },
    { $set: { status: "credited", creditsUnits: credits, feeUnits: fee, creditedAt: Date.now(), updatedAt: Date.now() } },
  );
  return (await deposits().findOne({ _id: deposit._id }))!;
}

/** Admin approves a manual exchange deposit. Pressing approve twice is safe. */
export async function approveManualDeposit(depositId: string): Promise<Deposit> {
  const deposit = await deposits().findOne({ _id: depositId });
  if (!deposit) throw notFound("Deposit not found.");
  if (deposit.verification !== "manual_admin") throw badRequest("That deposit is verified on chain.", "not_manual");
  if (deposit.status === "credited") return deposit;
  if (deposit.status === "rejected") throw conflict("That deposit was already rejected.", "already_rejected");

  await deposits().updateOne(
    { _id: deposit._id, status: { $in: ["pending", "confirming", "confirmed"] } },
    { $set: { status: "confirmed", observedUnits: deposit.declaredUnits ?? 0, updatedAt: Date.now() } },
  );
  return creditDeposit(depositId);
}

export async function rejectManualDeposit(depositId: string, reason: string): Promise<Deposit> {
  const deposit = await deposits().findOne({ _id: depositId });
  if (!deposit) throw notFound("Deposit not found.");
  if (deposit.status === "credited") throw conflict("That deposit was already credited.", "already_credited");

  await deposits().updateOne(
    { _id: deposit._id, status: { $nin: ["credited"] } },
    { $set: { status: "rejected", rejectionReason: reason.trim() || "Rejected by an admin.", updatedAt: Date.now() } },
  );
  return (await deposits().findOne({ _id: deposit._id }))!;
}

export async function listDeposits(filter: Record<string, unknown>, limit = 50): Promise<Deposit[]> {
  return deposits().find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
}
