// Cardano preprod settlement. Builds, signs and submits real transactions from
// the gateway's own vault key.
//
// The contract the withdrawal flow depends on:
//   · every error thrown from here happened BEFORE the transaction was
//     broadcast, so the caller may safely release the user's credits;
//   · if we cannot prove that, we return `ambiguous: true` with the hash and the
//     caller puts the withdrawal into manual_review instead of refunding.
// Getting that backwards pays the recipient twice, so nothing here throws after
// a successful submit.

import { readFileSync, statSync } from "node:fs";

import { Blockfrost, Koios, Lucid, getAddressDetails, type LucidEvolution } from "@lucid-evolution/lucid";

import { config } from "../config.js";
import { getSettlementAsset } from "./assets.js";
import { blockfrostConfigured, txConfirmations as blockfrostConfirmations } from "./blockfrost.js";
import { addressInfo, txStatus } from "./koios.js";

export class SettlementRejectedError extends Error {}
export class InsufficientReserveError extends Error {
  constructor(readonly assetId: string, readonly availableUnits: number, readonly requiredUnits: number) {
    super("Settlement liquidity is currently below the required amount.");
  }
}

const NETWORK = config.cardano.network === "preview" ? "Preview" : "Preprod";
const NETWORK_ID = 0; // both preprod and preview are testnets

let lucidPromise: Promise<LucidEvolution> | null = null;

/** The signing key is read from disk on first use and never leaves this module. */
function readSigningKey(): string {
  const path = config.cardano.signingKeyPath;
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) {
    throw new Error(`settlement key ${path} is group/world readable (mode ${mode.toString(8)}) — chmod 600 it`);
  }
  const key = readFileSync(path, "utf8").trim();
  if (!key.startsWith("ed25519_sk")) throw new Error("settlement key file does not contain a bech32 ed25519_sk");
  return key;
}

async function getLucid(): Promise<LucidEvolution> {
  if (!lucidPromise) {
    lucidPromise = (async () => {
      const provider = blockfrostConfigured()
        ? new Blockfrost(config.cardano.blockfrostUrl, config.cardano.blockfrostProjectId)
        : new Koios(config.cardano.koiosUrl, config.cardano.koiosToken || undefined);
      console.log(`[settlement] chain provider: ${blockfrostConfigured() ? "blockfrost" : "koios"}`);
      const lucid = await Lucid(provider, NETWORK);
      lucid.selectWallet.fromPrivateKey(readSigningKey());
      return lucid;
    })().catch((err) => {
      lucidPromise = null;
      throw err;
    });
  }
  return lucidPromise;
}

export async function getVaultAddress(): Promise<string> {
  const lucid = await getLucid();
  return lucid.wallet().address();
}

/**
 * Server-side destination check. A bech32 address from the wrong network is the
 * mistake people actually make, so the network id is checked explicitly.
 */
export function validateAddress(address: string): { ok: true } | { ok: false; reason: string } {
  const addr = address.trim();
  if (!addr) return { ok: false, reason: "Enter a Cardano address." };
  let details;
  try {
    details = getAddressDetails(addr);
  } catch {
    return { ok: false, reason: "That is not a valid Cardano address." };
  }
  if (!details.paymentCredential) return { ok: false, reason: "That address cannot receive payments." };
  if (details.networkId !== NETWORK_ID) {
    return { ok: false, reason: `That is a mainnet address. This gateway settles on Cardano ${config.cardano.network}.` };
  }
  if (details.type === "Byron") return { ok: false, reason: "Byron-era addresses are not supported." };
  return { ok: true };
}

export interface ReserveBalance {
  assetId: string;
  balanceUnits: number;
}

/** Current on-chain balance of the vault for one settlement asset. */
export async function getReserveBalance(assetId: string): Promise<number> {
  const asset = getSettlementAsset(assetId);
  const address = config.cardano.vaultAddress || (await getVaultAddress());
  const info = await addressInfo(address);
  if (!info) return 0;

  if (asset.unit === "lovelace") return Number(info.balance);

  const policyId = asset.unit.slice(0, 56);
  const assetName = asset.unit.slice(56);
  let total = 0;
  for (const utxo of info.utxo_set) {
    for (const a of utxo.asset_list ?? []) {
      if (a.policy_id === policyId && a.asset_name === assetName) total += Number(a.quantity);
    }
  }
  return total;
}

export async function getAllReserveBalances(assetIds: string[]): Promise<ReserveBalance[]> {
  const address = config.cardano.vaultAddress || (await getVaultAddress());
  const info = await addressInfo(address);
  return assetIds.map((assetId) => {
    const asset = getSettlementAsset(assetId);
    if (!info) return { assetId, balanceUnits: 0 };
    if (asset.unit === "lovelace") return { assetId, balanceUnits: Number(info.balance) };
    const policyId = asset.unit.slice(0, 56);
    const assetName = asset.unit.slice(56);
    let total = 0;
    for (const utxo of info.utxo_set) {
      for (const a of utxo.asset_list ?? []) {
        if (a.policy_id === policyId && a.asset_name === assetName) total += Number(a.quantity);
      }
    }
    return { assetId, balanceUnits: total };
  });
}

export interface SettlementEstimate {
  assetId: string;
  amountUnits: number;
  reserveUnits: number;
  sufficient: boolean;
  /** Rough network fee in lovelace. Real fee is computed when the tx is built. */
  networkFeeLovelace: number;
}

export async function estimateSettlement(assetId: string, amountUnits: number): Promise<SettlementEstimate> {
  const reserveUnits = await getReserveBalance(assetId);
  const asset = getSettlementAsset(assetId);
  // Native-asset payouts also carry ~1.2 ADA of min-UTxO that leaves the vault
  // with the token, so an ADA reserve is required either way.
  const needed = asset.unit === "lovelace" ? amountUnits + 1_500_000 : amountUnits;
  return {
    assetId,
    amountUnits,
    reserveUnits,
    sufficient: reserveUnits >= needed,
    networkFeeLovelace: 200_000,
  };
}

export interface SubmitResult {
  txHash: string;
  ambiguous: boolean;
}

/**
 * Build, sign and submit one settlement payment.
 *
 * Throws SettlementRejectedError / InsufficientReserveError only while nothing
 * is on chain. Once `submit` has been attempted we either return a hash or, if
 * the outcome is genuinely unknown, return it flagged ambiguous.
 */
export async function submitSettlement(opts: {
  assetId: string;
  destinationAddress: string;
  amountUnits: number;
}): Promise<SubmitResult> {
  const asset = getSettlementAsset(opts.assetId);
  const check = validateAddress(opts.destinationAddress);
  if (!check.ok) throw new SettlementRejectedError(check.reason);
  if (opts.amountUnits < asset.minSettlementUnits) {
    throw new SettlementRejectedError(`Minimum settlement for ${asset.label} is ${asset.minSettlementUnits} base units.`);
  }

  const estimate = await estimateSettlement(opts.assetId, opts.amountUnits);
  if (!estimate.sufficient) {
    throw new InsufficientReserveError(opts.assetId, estimate.reserveUnits, opts.amountUnits);
  }

  const lucid = await getLucid();
  const payload = asset.unit === "lovelace"
    ? { lovelace: BigInt(opts.amountUnits) }
    : { [asset.unit]: BigInt(opts.amountUnits) };

  let signedCbor: string;
  let txHash: string;
  try {
    const tx = await lucid.newTx().pay.ToAddress(opts.destinationAddress, payload).complete();
    const signed = await tx.sign.withWallet().complete();
    signedCbor = signed.toCBOR();
    txHash = signed.toHash();
  } catch (err) {
    // Balancing, coin selection and signing all happen locally: nothing was
    // broadcast, so this is always safe to refund.
    throw new SettlementRejectedError(`Could not build the settlement transaction: ${message(err)}`);
  }

  return submitSigned(signedCbor, txHash);
}

/**
 * Submit, then decide whether we actually know what happened.
 * A first-attempt node rejection is proof the transaction never landed. Anything
 * else (timeout, 5xx, socket reset) is not, so we retry the idempotent submit
 * and watch the chain before giving up.
 */
async function submitSigned(cbor: string, txHash: string): Promise<SubmitResult> {
  try {
    return { txHash: await submitOnce(cbor), ambiguous: false };
  } catch (err) {
    if (err instanceof SettlementRejectedError) throw err;
    console.error(`[settlement] ambiguous submit for ${txHash}: ${message(err)}`);
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 6_000));
    const confirmations = await confirmationsOf(txHash).catch(() => 0);
    if (confirmations > 0) {
      console.warn(`[settlement] ${txHash} confirmed after an ambiguous submit`);
      return { txHash, ambiguous: false };
    }
    try {
      return { txHash: await submitOnce(cbor), ambiguous: false };
    } catch (err) {
      // A rejection on a RESUBMIT is not proof: if our transaction was applied,
      // its inputs are already spent and the node rejects the duplicate. Only
      // the first attempt may conclude "rejected".
      if (!(err instanceof SettlementRejectedError)) continue;
    }
  }

  console.error(`[settlement] ${txHash} unresolved — credits stay locked, manual review required`);
  return { txHash, ambiguous: true };
}

async function submitOnce(cbor: string): Promise<string> {
  const lucid = await getLucid();
  try {
    return await lucid.config().provider!.submitTx(cbor);
  } catch (err) {
    const text = message(err);
    // Koios/Ogmios surface node validation failures as a 400 with a reason. Those
    // are decided: the transaction was never accepted.
    if (/\b400\b/.test(text) || /ValidationError|TxSubmitFail|invalid/i.test(text)) {
      throw new SettlementRejectedError(`The node rejected the settlement transaction: ${text.slice(0, 300)}`);
    }
    throw err;
  }
}

export interface TransactionStatus {
  txHash: string;
  onChain: boolean;
  confirmations: number;
}

export async function getTransactionStatus(txHash: string): Promise<TransactionStatus> {
  const confirmations = await confirmationsOf(txHash);
  return { txHash, onChain: confirmations > 0, confirmations };
}

/**
 * Confirmations from Koios, falling back to Blockfrost. Either source alone is
 * enough; asking both means an indexer outage cannot strand a settled
 * withdrawal in "unknown".
 */
async function confirmationsOf(txHash: string): Promise<number> {
  try {
    const status = await txStatus(txHash);
    if (status?.num_confirmations != null) return status.num_confirmations;
  } catch (err) {
    console.warn(`[settlement] koios tx_status failed for ${txHash}: ${message(err)}`);
  }
  if (!blockfrostConfigured()) return 0;
  try {
    return (await blockfrostConfirmations(txHash)) ?? 0;
  } catch (err) {
    console.warn(`[settlement] blockfrost tx lookup failed for ${txHash}: ${message(err)}`);
    return 0;
  }
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
