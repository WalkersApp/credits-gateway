// Withdrawal lifecycle. The rule that shapes everything here:
//
//   credits are LOCKED while the settlement is in flight and only consumed once
//   the transaction is on chain. They are released only when we can prove the
//   transaction was never broadcast. When the submit outcome is unknown the
//   withdrawal goes to manual_review with the credits still locked — refunding
//   there could hand back credits for a payment that later confirms.

import { config } from "../config.js";
import { withdrawals } from "../db.js";
import { GatewayError, badRequest, conflict, notFound, unavailable } from "../errors.js";
import { newId } from "../ids.js";
import { assertPositiveUnits, creditsToAssetUnits, feeUnits, parseUnits } from "../money.js";
import { getBalance, lockCredits, spendLocked, unlockCredits } from "../credits/accounts.js";
import { assertSettleable } from "../credits/integrity.js";
import { SETTLEMENT_RATE_BPS, enabledSettlementAssets } from "../settlement/assets.js";
import * as cardano from "../settlement/cardano.js";
import { InsufficientReserveError, SettlementRejectedError } from "../settlement/cardano.js";
import type { Withdrawal } from "../../src/shared/types.js";

const DUPLICATE_KEY = 11000;

/** The settlement backend. Swapped out in tests; in the running gateway it is
 *  always the real Cardano module. */
export interface SettlementRunner {
  validateAddress: typeof cardano.validateAddress;
  estimateSettlement: typeof cardano.estimateSettlement;
  submitSettlement: typeof cardano.submitSettlement;
  getTransactionStatus: typeof cardano.getTransactionStatus;
}

let runner: SettlementRunner = cardano;

export function setSettlementRunner(next: SettlementRunner): void {
  runner = next;
}

export interface WithdrawalQuote {
  creditsUnits: number;
  feeUnits: number;
  netCreditsUnits: number;
  settlementAssetId: string;
  settlementUnits: number;
  rateBps: number;
}

/** Rates and fees are computed here and nowhere else. The client sends an
 *  amount and an asset id; anything else it sends is ignored. */
export function quoteWithdrawal(creditsAmount: string, settlementAssetId: string): WithdrawalQuote {
  const asset = enabledSettlementAssets().find((a) => a.id === settlementAssetId);
  if (!asset) throw badRequest("That settlement asset is not available.", "unknown_asset");

  const creditsUnits = parseUnits(creditsAmount);
  assertPositiveUnits(creditsUnits, "withdrawal amount");
  if (creditsUnits < config.fees.minWithdrawalUnits || creditsUnits > config.fees.maxWithdrawalUnits) {
    throw badRequest(
      `Withdrawals must be between ${config.fees.minWithdrawalUnits / 1e6} and ${config.fees.maxWithdrawalUnits / 1e6} credits.`,
      "out_of_range",
    );
  }

  const fee = feeUnits(creditsUnits, config.fees.withdrawalFlatUnits, config.fees.withdrawalBps);
  const net = creditsUnits - fee;
  if (net <= 0) throw badRequest("The amount must be larger than the withdrawal fee.", "fee_exceeds_amount");

  const rateBps = SETTLEMENT_RATE_BPS[asset.id] ?? 10_000;
  const settlementUnits = creditsToAssetUnits(net, asset.decimals, rateBps);
  if (settlementUnits < asset.minSettlementUnits) {
    throw badRequest(
      `After the fee this settles ${settlementUnits / 10 ** asset.decimals} ${asset.label}, below the minimum of ` +
        `${asset.minSettlementUnits / 10 ** asset.decimals}.`,
      "below_minimum",
    );
  }

  return { creditsUnits, feeUnits: fee, netCreditsUnits: net, settlementAssetId: asset.id, settlementUnits, rateBps };
}

export interface CreateWithdrawalInput {
  amount: string;
  settlementAssetId: string;
  destinationAddress: string;
  requestKey?: string | null;
}

export async function createWithdrawal(userId: string, input: CreateWithdrawalInput): Promise<Withdrawal> {
  await assertSettleable();

  const destination = (input.destinationAddress || "").trim();
  const addressCheck = runner.validateAddress(destination);
  if (!addressCheck.ok) throw badRequest(addressCheck.reason, "bad_address");

  const quote = quoteWithdrawal(input.amount, input.settlementAssetId);

  const balance = await getBalance(userId);
  if (balance.availableUnits < quote.creditsUnits) throw badRequest("You do not have that many credits.", "insufficient_credits");

  // Refuse before locking anything if the vault plainly cannot cover this. The
  // user keeps their credits available rather than watching them sit locked.
  const estimate = await runner.estimateSettlement(quote.settlementAssetId, quote.settlementUnits);
  if (!estimate.sufficient) {
    throw unavailable(
      "Settlement liquidity is currently below the required amount. Your credits remain available — please try a " +
        "smaller amount or come back once the reserve has been topped up.",
      "insufficient_reserve",
    );
  }

  const now = Date.now();
  const w: Withdrawal = {
    id: newId(),
    userId,
    requestKey: input.requestKey?.trim() || null,
    status: "pending",
    creditsUnits: quote.creditsUnits,
    feeUnits: quote.feeUnits,
    netCreditsUnits: quote.netCreditsUnits,
    settlementAssetId: quote.settlementAssetId,
    settlementUnits: quote.settlementUnits,
    rateBps: quote.rateBps,
    destinationAddress: destination,
    txHash: null,
    confirmations: 0,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    confirmedAt: null,
    refundedAt: null,
  };

  try {
    await withdrawals().insertOne({ _id: w.id, ...w });
  } catch (err) {
    if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
    // Same client request key: return the withdrawal we already made instead of
    // locking a second set of credits.
    const existing = await withdrawals().findOne({ userId, requestKey: w.requestKey });
    if (existing) return existing;
    throw err;
  }

  await lockCredits(userId, quote.creditsUnits, {
    kind: "withdrawal",
    refType: "withdrawal",
    refId: w.id,
    idempotencyKey: `withdrawal:lock:${w.id}`,
  });

  return settleWithdrawal(w.id);
}

/**
 * Build, sign and broadcast the settlement for a pending withdrawal.
 * Only one caller can move a withdrawal out of `pending`, so calling this twice
 * (retry, background job, admin button) cannot settle twice.
 */
export async function settleWithdrawal(withdrawalId: string): Promise<Withdrawal> {
  const claimed = await withdrawals().findOneAndUpdate(
    { _id: withdrawalId, status: "pending" },
    { $set: { status: "processing", failureReason: null, updatedAt: Date.now() } },
    { returnDocument: "after" },
  );
  if (!claimed) {
    const current = await withdrawals().findOne({ _id: withdrawalId });
    if (!current) throw notFound("Withdrawal not found.");
    return current;
  }

  try {
    await assertSettleable();
    const result = await runner.submitSettlement({
      assetId: claimed.settlementAssetId,
      destinationAddress: claimed.destinationAddress,
      amountUnits: claimed.settlementUnits,
    });

    if (result.ambiguous) {
      await withdrawals().updateOne(
        { _id: withdrawalId },
        {
          $set: {
            status: "manual_review",
            txHash: result.txHash,
            failureReason:
              "The settlement was broadcast but its outcome could not be confirmed. The credits stay locked until " +
              "an admin checks the transaction on chain — they are never refunded automatically, because the " +
              "transaction may still confirm.",
            submittedAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      );
    } else {
      await withdrawals().updateOne(
        { _id: withdrawalId },
        { $set: { status: "submitted", txHash: result.txHash, submittedAt: Date.now(), updatedAt: Date.now() } },
      );
    }
    return (await withdrawals().findOne({ _id: withdrawalId }))!;
  } catch (err) {
    if (err instanceof InsufficientReserveError) {
      // Nothing was built. Park it: the credits stay locked and the background
      // job retries once the reserve is topped up.
      await withdrawals().updateOne(
        { _id: withdrawalId },
        {
          $set: {
            status: "pending",
            failureReason:
              "Settlement liquidity is currently below the required amount. Your credits are locked safely and this " +
              "withdrawal will settle once the reserve is topped up.",
            updatedAt: Date.now(),
          },
        },
      );
      return (await withdrawals().findOne({ _id: withdrawalId }))!;
    }

    // Everything else that reaches here happened before broadcast (build, sign,
    // or a first-attempt node rejection), so releasing the credits is safe.
    const reason = err instanceof SettlementRejectedError || err instanceof GatewayError
      ? err.message
      : `Settlement failed before broadcast: ${err instanceof Error ? err.message : String(err)}`;
    await withdrawals().updateOne(
      { _id: withdrawalId },
      { $set: { status: "failed", failureReason: reason, updatedAt: Date.now() } },
    );
    return refundWithdrawal(withdrawalId);
  }
}

/** Release the locked credits of a failed withdrawal. Runs at most once. */
export async function refundWithdrawal(withdrawalId: string): Promise<Withdrawal> {
  const w = await withdrawals().findOne({ _id: withdrawalId });
  if (!w) throw notFound("Withdrawal not found.");
  if (w.status === "refunded") return w;
  if (w.status !== "failed" && w.status !== "pending") {
    throw conflict(`A ${w.status} withdrawal cannot be refunded.`, "not_refundable");
  }

  await unlockCredits(w.userId, w.creditsUnits, {
    kind: "refund",
    refType: "withdrawal",
    refId: w._id,
    idempotencyKey: `withdrawal:refund:${w._id}`,
  });
  await withdrawals().updateOne(
    { _id: withdrawalId, status: { $in: ["failed", "pending"] } },
    { $set: { status: "refunded", refundedAt: Date.now(), updatedAt: Date.now() } },
  );
  return (await withdrawals().findOne({ _id: withdrawalId }))!;
}

/** Check a submitted settlement and, once it is on chain, consume the credits. */
export async function confirmSettlement(withdrawalId: string): Promise<Withdrawal> {
  const w = await withdrawals().findOne({ _id: withdrawalId });
  if (!w) throw notFound("Withdrawal not found.");
  if (w.status === "confirmed") return w;
  if (!w.txHash || (w.status !== "submitted" && w.status !== "manual_review")) return w;

  const status = await runner.getTransactionStatus(w.txHash);
  await withdrawals().updateOne({ _id: withdrawalId }, { $set: { confirmations: status.confirmations, updatedAt: Date.now() } });
  if (!status.onChain || status.confirmations < config.cardano.confirmationsRequired) {
    return (await withdrawals().findOne({ _id: withdrawalId }))!;
  }

  await spendLocked(w.userId, w.creditsUnits, {
    kind: "withdrawal",
    refType: "withdrawal",
    refId: w._id,
    idempotencyKey: `withdrawal:spend:${w._id}`,
  });
  await withdrawals().updateOne(
    { _id: withdrawalId, status: { $in: ["submitted", "manual_review"] } },
    { $set: { status: "confirmed", confirmedAt: Date.now(), failureReason: null, updatedAt: Date.now() } },
  );
  return (await withdrawals().findOne({ _id: withdrawalId }))!;
}

/** Admin resolution for a manual_review withdrawal that never landed on chain. */
export async function releaseManualReview(withdrawalId: string, note: string): Promise<Withdrawal> {
  const w = await withdrawals().findOne({ _id: withdrawalId });
  if (!w) throw notFound("Withdrawal not found.");
  if (w.status !== "manual_review") throw conflict("That withdrawal is not in manual review.", "not_in_review");

  // Refuse while the transaction still might land. The whole point of
  // manual_review is that we do not guess.
  if (w.txHash) {
    const status = await runner.getTransactionStatus(w.txHash);
    if (status.onChain) throw conflict("That settlement is on chain — confirm it instead of refunding.", "tx_on_chain");
  }

  await unlockCredits(w.userId, w.creditsUnits, {
    kind: "refund",
    refType: "withdrawal",
    refId: w._id,
    idempotencyKey: `withdrawal:refund:${w._id}`,
  });
  await withdrawals().updateOne(
    { _id: withdrawalId, status: "manual_review" },
    {
      $set: {
        status: "refunded",
        refundedAt: Date.now(),
        failureReason: note.trim() || "Admin confirmed the transaction never reached the chain.",
        updatedAt: Date.now(),
      },
    },
  );
  return (await withdrawals().findOne({ _id: withdrawalId }))!;
}

export async function listWithdrawals(filter: Record<string, unknown>, limit = 50): Promise<Withdrawal[]> {
  return withdrawals().find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
}

/** Settlement value committed but not yet on chain — reserve we cannot re-spend. */
export async function committedSettlementUnits(assetId: string): Promise<number> {
  const [row] = await withdrawals()
    .aggregate<{ total: number }>([
      { $match: { settlementAssetId: assetId, status: { $in: ["pending", "processing", "submitted", "manual_review"] } } },
      { $group: { _id: null, total: { $sum: "$settlementUnits" } } },
    ])
    .toArray();
  return row?.total ?? 0;
}
