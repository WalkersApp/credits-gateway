// Reserve = the settlement liquidity this gateway custodies on Cardano preprod.
// It is a custodial hot wallet controlled by the gateway operator, and the
// architecture page says exactly that.
//
// Two numbers matter and they are measured independently:
//   · CAPACITY  — read from the chain: what the vault can actually pay out.
//   · LIABILITY — read from the ledger: credits issued and not yet settled.
// Capacity never comes from a rebalance record or any other operator entry, so
// an optimistic bookkeeping mistake cannot make the gateway look solvent.

import { config } from "./config.js";
import { accounts, reserveSnapshots } from "./db.js";
import { newId } from "./ids.js";
import { assetUnitsToCredits } from "./money.js";
import { SETTLEMENT_RATE_BPS, enabledSettlementAssets } from "./settlement/assets.js";
import { getAllReserveBalances, getVaultAddress } from "./settlement/cardano.js";
import { committedSettlementUnits } from "./withdrawals/service.js";
import type {
  ReserveAssetStatus, ReserveLiability, ReserveStatus, ReserveWarning, SettlementAsset,
} from "../src/shared/types.js";

/** The chain reader. Swapped out in tests; in the running gateway it is always
 *  the real Cardano module — mirrors setSettlementRunner / setDepositInspector. */
export interface ReserveReader {
  getAllReserveBalances: typeof getAllReserveBalances;
  getVaultAddress: typeof getVaultAddress;
}

let reader: ReserveReader = { getAllReserveBalances, getVaultAddress };

export function setReserveReader(next: ReserveReader): void {
  reader = next;
}

function health(freeUnits: number, limits: SettlementAsset["reserve"]): "healthy" | "low" | "critical" {
  if (freeUnits < limits.criticalUnits) return "critical";
  if (freeUnits < limits.minUnits) return "low";
  return "healthy";
}

/** Credits issued and not yet settled — what the gateway owes its users. */
export async function getOutstandingCredits(): Promise<{ available: number; locked: number; total: number }> {
  const [row] = await accounts()
    .aggregate<{ available: number; locked: number }>([
      { $group: { _id: null, available: { $sum: "$availableUnits" }, locked: { $sum: "$lockedUnits" } } },
    ])
    .toArray();
  const available = row?.available ?? 0;
  const locked = row?.locked ?? 0;
  return { available, locked, total: available + locked };
}

function buildWarnings(assets: ReserveAssetStatus[], liability: ReserveLiability): ReserveWarning[] {
  const warnings: ReserveWarning[] = [];

  for (const a of assets) {
    if (a.health === "critical") {
      warnings.push({
        severity: "critical",
        code: "reserve_critical",
        assetId: a.assetId,
        message:
          `${a.label} free reserve is below the critical threshold. New withdrawals in this asset will be ` +
          "refused before any credits are locked, and queued ones stay locked until the reserve is topped up.",
      });
    } else if (a.health === "low") {
      warnings.push({
        severity: "warning",
        code: "reserve_low",
        assetId: a.assetId,
        message: `${a.label} free reserve is below its minimum threshold and should be topped up toward target.`,
      });
    }

    // A reserve can be "healthy" against its own floor and still be unable to
    // honour the largest withdrawal the gateway advertises. Worth saying.
    if (a.health !== "critical" && a.capacityCreditUnits < config.fees.maxWithdrawalUnits) {
      warnings.push({
        severity: "info",
        code: "capacity_below_max_withdrawal",
        assetId: a.assetId,
        message:
          `${a.label} capacity is below the configured maximum single withdrawal. Large withdrawals will be ` +
          "refused at request time rather than queued.",
      });
    }
  }

  if (!liability.fullyCovered) {
    warnings.push({
      severity: "critical",
      code: "liability_uncovered",
      assetId: null,
      message:
        "Outstanding credits exceed the settlement capacity held on chain. This is expected on a preprod " +
        "deployment funded from the testnet faucet; in production it is the condition a treasury policy " +
        "must prevent.",
    });
  }

  return warnings;
}

export async function getReserveStatus(): Promise<ReserveStatus> {
  const assets = enabledSettlementAssets();
  const address = config.cardano.vaultAddress || (await reader.getVaultAddress());
  const balances = await reader.getAllReserveBalances(assets.map((a) => a.id));

  const rows: ReserveAssetStatus[] = await Promise.all(
    assets.map(async (asset) => {
      const balanceUnits = balances.find((b) => b.assetId === asset.id)?.balanceUnits ?? 0;
      const lockedUnits = await committedSettlementUnits(asset.id);
      const availableUnits = Math.max(0, balanceUnits - lockedUnits);
      const rateBps = SETTLEMENT_RATE_BPS[asset.id] ?? 10_000;
      return {
        assetId: asset.id,
        label: asset.label,
        balanceUnits,
        lockedUnits,
        availableUnits,
        capacityCreditUnits: assetUnitsToCredits(availableUnits, asset.decimals, rateBps),
        criticalUnits: asset.reserve.criticalUnits,
        minUnits: asset.reserve.minUnits,
        targetUnits: asset.reserve.targetUnits,
        shortfallToTargetUnits: Math.max(0, asset.reserve.targetUnits - availableUnits),
        health: health(availableUnits, asset.reserve),
        official: asset.official,
      };
    }),
  );

  const outstanding = await getOutstandingCredits();
  const totalCapacity = rows.reduce((sum, r) => sum + r.capacityCreditUnits, 0);
  const liability: ReserveLiability = {
    outstandingCreditUnits: outstanding.total,
    availableCreditUnits: outstanding.available,
    lockedCreditUnits: outstanding.locked,
    totalCapacityCreditUnits: totalCapacity,
    surplusCreditUnits: totalCapacity - outstanding.total,
    coverageBps: outstanding.total > 0 ? Math.floor((totalCapacity * 10_000) / outstanding.total) : null,
    fullyCovered: totalCapacity >= outstanding.total,
  };

  return {
    network: `cardano-${config.cardano.network}`,
    vaultAddress: address,
    assets: rows,
    liability,
    warnings: buildWarnings(rows, liability),
    checkedAt: Date.now(),
  };
}

/** Snapshots exist so the evidence page can show reserve history, not just now. */
export async function snapshotReserve(): Promise<ReserveStatus> {
  const status = await getReserveStatus();
  await reserveSnapshots().insertOne({ _id: newId(), ...status });
  return status;
}
