// Validates a deposit that the user says they sent to the gateway's Cardano
// preprod deposit address. We never trust the amount the user typed — we read
// the transaction's outputs and use what actually arrived.

import { config } from "../config.js";
import { txInfo, txStatus } from "../settlement/koios.js";

export interface OnChainDeposit {
  found: boolean;
  amountUnits: number;
  confirmations: number;
  reason?: string;
}

/** `assetUnit` is "lovelace" or policyId+hexAssetName. */
export async function inspectCardanoDeposit(txHash: string, assetUnit: string): Promise<OnChainDeposit> {
  const address = config.cardanoDeposits.address;
  if (!address) return { found: false, amountUnits: 0, confirmations: 0, reason: "Cardano deposits are not configured." };

  const info = await txInfo(txHash);
  if (!info) return { found: false, amountUnits: 0, confirmations: 0, reason: "That transaction is not on Cardano preprod yet." };

  let amountUnits = 0;
  for (const out of info.outputs) {
    if (out.payment_addr?.bech32 !== address) continue;
    if (assetUnit === "lovelace") {
      amountUnits += Number(out.value);
    } else {
      const policyId = assetUnit.slice(0, 56);
      const assetName = assetUnit.slice(56);
      for (const a of out.asset_list ?? []) {
        if (a.policy_id === policyId && a.asset_name === assetName) amountUnits += Number(a.quantity);
      }
    }
  }

  if (amountUnits <= 0) {
    return {
      found: false,
      amountUnits: 0,
      confirmations: 0,
      reason: "That transaction does not pay the expected asset to the gateway deposit address.",
    };
  }

  const status = await txStatus(txHash);
  return { found: true, amountUnits, confirmations: status?.num_confirmations ?? 0 };
}
