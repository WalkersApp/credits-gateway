// Creates the dedicated preprod settlement wallet.
//
//   npm run wallet:create
//
// Writes a bech32 ed25519 signing key to SETTLEMENT_KEY_PATH with mode 600 and
// prints the address to fund. The key is never printed and never enters the repo.

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Koios, Lucid, generatePrivateKey } from "@lucid-evolution/lucid";

import { config } from "../server/config.js";

async function main() {
  const path = config.cardano.signingKeyPath;
  if (existsSync(path)) {
    console.error(`A settlement key already exists at ${path}. Refusing to overwrite it.`);
    console.error("To rotate: move the old key aside, re-run this, then move the remaining funds.");
    process.exit(1);
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const key = generatePrivateKey();
  writeFileSync(path, `${key}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);

  const lucid = await Lucid(new Koios(config.cardano.koiosUrl), config.cardano.network === "preview" ? "Preview" : "Preprod");
  lucid.selectWallet.fromPrivateKey(key);
  const address = await lucid.wallet().address();

  console.log(`network:  cardano ${config.cardano.network}`);
  console.log(`key file: ${path} (mode 600)`);
  console.log(`address:  ${address}`);
  console.log("");
  console.log("Put this in .env:");
  console.log(`SETTLEMENT_VAULT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
