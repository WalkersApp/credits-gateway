// Sends preprod ADA from one of the project's own test keys. This exists so the
// end-to-end walkthrough in the README can be reproduced without a browser
// wallet — it is a test utility, not part of the gateway's runtime.
//
//   npx tsx scripts/testnet-send.ts <keyFile> <toAddress> <ada>

import { readFileSync } from "node:fs";

import { Blockfrost, Koios, Lucid } from "@lucid-evolution/lucid";

import { config } from "../server/config.js";

async function main() {
  const [keyPath, destination, adaAmount] = process.argv.slice(2);
  if (!keyPath || !destination || !adaAmount) {
    throw new Error("usage: testnet-send.ts <keyFile> <toAddress> <ada>");
  }

  const provider = config.cardano.blockfrostProjectId
    ? new Blockfrost(config.cardano.blockfrostUrl, config.cardano.blockfrostProjectId)
    : new Koios(config.cardano.koiosUrl, config.cardano.koiosToken || undefined);

  const lucid = await Lucid(provider, config.cardano.network === "preview" ? "Preview" : "Preprod");
  lucid.selectWallet.fromPrivateKey(readFileSync(keyPath, "utf8").trim());

  const lovelace = BigInt(Math.round(Number(adaAmount) * 1_000_000));
  const tx = await lucid.newTx().pay.ToAddress(destination, { lovelace }).complete();
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();

  console.log(JSON.stringify({ from: await lucid.wallet().address(), to: destination, ada: Number(adaAmount), txHash }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
