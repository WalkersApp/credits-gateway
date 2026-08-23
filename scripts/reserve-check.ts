// Prints the settlement vault's address and on-chain balances.
//
//   npm run reserve:check

import { config } from "../server/config.js";
import { enabledSettlementAssets } from "../server/settlement/assets.js";
import { getAllReserveBalances, getVaultAddress } from "../server/settlement/cardano.js";

async function main() {
  const assets = enabledSettlementAssets();
  const address = await getVaultAddress();
  const balances = await getAllReserveBalances(assets.map((a) => a.id));

  console.log(`network: cardano ${config.cardano.network}`);
  console.log(`vault:   ${address}`);
  if (config.cardano.vaultAddress && config.cardano.vaultAddress !== address) {
    console.log(`WARNING: SETTLEMENT_VAULT_ADDRESS is ${config.cardano.vaultAddress}, which is not this key's address.`);
  }
  for (const asset of assets) {
    const units = balances.find((b) => b.assetId === asset.id)?.balanceUnits ?? 0;
    console.log(`${asset.label}: ${units / 10 ** asset.decimals}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
