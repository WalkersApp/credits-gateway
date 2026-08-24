// Rebalancing is a recorded operational process, not an automated market maker.
// An admin books what was moved, through which provider, and what actually
// arrived — so the reserve's history is auditable even though the conversion
// itself happens off this system.

import { rebalances } from "./db.js";
import { badRequest, notFound } from "./errors.js";
import { newId } from "./ids.js";
import type { Rebalance } from "../src/shared/types.js";

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
