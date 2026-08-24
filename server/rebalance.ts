// Rebalancing is a recorded operational process, not an automated market maker.
// An admin books what was moved, through which provider, and what actually
// arrived — so the reserve's history is auditable even though the conversion
// itself happens off this system.
//
// The gateway's own contribution is the REQUEST, not the movement:
//
//   reserve below threshold -> auto rebalance request (status "planned")
//                           -> treasury operator acts, off-system
//                           -> operator books the result
//                           -> capacity is re-read from the chain
//
// A request is a signal for a human. Nothing here moves funds, and no provider
// is connected — see providers/registry.ts.

import { rebalances } from "./db.js";
import { badRequest, notFound } from "./errors.js";
import { newId } from "./ids.js";
import { formatUnits } from "./money.js";
import { getSettlementAsset } from "./settlement/assets.js";
import type { Rebalance, ReserveStatus } from "../src/shared/types.js";

export interface RecordRebalanceInput {
  sourceNetwork: string;
  sourceAsset: string;
  sourceAmount: string;
  provider: string;
  destinationAssetId: string;
  expectedAmount: string;
  reference?: string;
  note?: string;
}

export async function recordRebalance(input: RecordRebalanceInput): Promise<Rebalance> {
  for (const field of ["sourceNetwork", "sourceAsset", "sourceAmount", "provider", "destinationAssetId", "expectedAmount"] as const) {
    if (!String(input[field] ?? "").trim()) throw badRequest(`${field} is required.`, "missing_field");
  }
  const now = Date.now();
  const doc: Rebalance = {
    id: newId(),
    sourceNetwork: input.sourceNetwork.trim(),
    sourceAsset: input.sourceAsset.trim(),
    sourceAmount: input.sourceAmount.trim(),
    provider: input.provider.trim(),
    destinationAssetId: input.destinationAssetId.trim(),
    expectedAmount: input.expectedAmount.trim(),
    actualAmount: null,
    reference: input.reference?.trim() || null,
    status: "planned",
    note: input.note?.trim() || "",
    origin: "admin",
    trigger: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  await rebalances().insertOne({ _id: doc.id, ...doc });
  return doc;
}

export async function updateRebalance(
  id: string,
  patch: { status?: Rebalance["status"]; actualAmount?: string; reference?: string; note?: string },
): Promise<Rebalance> {
  const set: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.status) {
    if (!["planned", "processing", "completed", "failed"].includes(patch.status)) throw badRequest("Unknown status.", "bad_status");
    set.status = patch.status;
    if (patch.status === "completed") set.completedAt = Date.now();
  }
  if (patch.actualAmount !== undefined) set.actualAmount = patch.actualAmount.trim() || null;
  if (patch.reference !== undefined) set.reference = patch.reference.trim() || null;
  if (patch.note !== undefined) set.note = patch.note.trim();

  const updated = await rebalances().findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: "after" });
  if (!updated) throw notFound("Rebalance not found.");
  return updated;
}

export async function listRebalances(limit = 50): Promise<Rebalance[]> {
  return rebalances().find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}


/** Requests still awaiting operator action for an asset. */
async function openRequestFor(assetId: string): Promise<Rebalance | null> {
  return rebalances().findOne({
    destinationAssetId: assetId,
    status: { $in: ["planned", "processing"] },
  });
}

/**
 * Raise a rebalance request for every settlement asset whose free reserve has
 * fallen below its minimum threshold.
 *
 * Idempotent by design: while a request for an asset is still open, no second
 * one is created. Otherwise a job running every 20 seconds would bury the
 * operator in duplicates of the same alert.
 */
export async function requestRebalancesForLowReserves(status: ReserveStatus): Promise<Rebalance[]> {
  const created: Rebalance[] = [];

  for (const asset of status.assets) {
    if (asset.health === "healthy") continue;
    if (await openRequestFor(asset.assetId)) continue;

    const decimals = getSettlementAsset(asset.assetId).decimals;
    const needed = asset.shortfallToTargetUnits;
    const now = Date.now();
    const doc: Rebalance = {
      id: newId(),
      // Unassigned on purpose: the gateway knows the reserve is short, not where
      // the liquidity should come from. A person decides that.
      sourceNetwork: "unassigned",
      sourceAsset: "unassigned",
      sourceAmount: "0",
      provider: "unassigned",
      destinationAssetId: asset.assetId,
      expectedAmount: formatUnits(needed, decimals),
      actualAmount: null,
      reference: null,
      status: "planned",
      note:
        `Raised automatically: free ${asset.label} reserve is ${formatUnits(asset.availableUnits, decimals)}, ` +
        `below the ${formatUnits(asset.minUnits, decimals)} minimum. Topping up to the ` +
        `${formatUnits(asset.targetUnits, decimals)} target needs ${formatUnits(needed, decimals)}. ` +
        "Awaiting treasury action — the gateway does not move liquidity itself.",
      origin: "auto",
      trigger: {
        assetId: asset.assetId,
        availableUnits: asset.availableUnits,
        minUnits: asset.minUnits,
        targetUnits: asset.targetUnits,
        health: asset.health,
      },
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    await rebalances().insertOne({ _id: doc.id, ...doc });
    created.push(doc);
  }

  return created;
}
