// Reserve = the settlement liquidity this gateway custodies on Cardano preprod.
// It is a custodial hot wallet controlled by the gateway operator, and the
// architecture page says exactly that.

import { config } from "./config.js";
import { reserveSnapshots } from "./db.js";
import { newId } from "./ids.js";
import { enabledSettlementAssets } from "./settlement/assets.js";
import { getAllReserveBalances, getVaultAddress } from "./settlement/cardano.js";
import { committedSettlementUnits } from "./withdrawals/service.js";
import type { ReserveStatus, SettlementAsset } from "../src/shared/types.js";

function health(freeUnits: number, limits: SettlementAsset["reserve"]): "healthy" | "low" | "critical" {
  if (freeUnits < limits.criticalUnits) return "critical";
  if (freeUnits < limits.minUnits) return "low";
  return "healthy";
}

export async function getReserveStatus(): Promise<ReserveStatus> {
  const assets = enabledSettlementAssets();
  const address = config.cardano.vaultAddress || (await getVaultAddress());
  const balances = await getAllReserveBalances(assets.map((a) => a.id));

  const rows = await Promise.all(
    assets.map(async (asset) => {
      const balanceUnits = balances.find((b) => b.assetId === asset.id)?.balanceUnits ?? 0;
      const lockedUnits = await committedSettlementUnits(asset.id);
      return {
        assetId: asset.id,
        label: asset.label,
        balanceUnits,
        lockedUnits,
        criticalUnits: asset.reserve.criticalUnits,
        minUnits: asset.reserve.minUnits,
        targetUnits: asset.reserve.targetUnits,
        health: health(balanceUnits - lockedUnits, asset.reserve),
        official: asset.official,
      };
    }),
  );

  return { network: `cardano-${config.cardano.network}`, vaultAddress: address, assets: rows, checkedAt: Date.now() };
}

/** Snapshots exist so the evidence page can show reserve history, not just now. */
export async function snapshotReserve(): Promise<ReserveStatus> {
  const status = await getReserveStatus();
  await reserveSnapshots().insertOne({ _id: newId(), ...status });
  return status;
}
