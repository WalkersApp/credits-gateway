import { config, assertSecrets } from "./server/config.js";
import { createApp } from "./server/app.js";
import { connect } from "./server/db.js";
import { startJobs } from "./server/jobs.js";
import { getVaultAddress } from "./server/settlement/cardano.js";

async function main() {
  assertSecrets();
  await connect();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[gateway] listening on :${config.port} (${config.env})`);
    const chainReads = config.cardano.blockfrostProjectId
      ? `blockfrost + koios`
      : `koios (${config.cardano.koiosUrl})`;
    console.log(`[gateway] cardano ${config.cardano.network} via ${chainReads}`);
    console.log(`[gateway] database ${config.mongoDb}`);
  });

  // Prove the signing key is readable and matches the configured vault before
  // anyone tries to withdraw, rather than failing on the first payout.
  try {
    const address = await getVaultAddress();
    if (config.cardano.vaultAddress && config.cardano.vaultAddress !== address) {
      console.error(`[gateway] SETTLEMENT_VAULT_ADDRESS does not match the signing key (key gives ${address})`);
    } else {
      console.log(`[gateway] settlement vault ${address}`);
    }
  } catch (err) {
    console.error("[gateway] settlement wallet unavailable:", err instanceof Error ? err.message : err);
  }

  startJobs();
}

main().catch((err) => {
  console.error("[gateway] failed to start:", err);
  process.exit(1);
});
