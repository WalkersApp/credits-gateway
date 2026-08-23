// Minimal Koios client for the things Lucid does not give us directly:
// reserve balances and transaction confirmations. Koios needs no API key on
// preprod, which keeps this reference implementation runnable by anyone.

import { config } from "../config.js";

const headers: Record<string, string> = { "content-type": "application/json" };
if (config.cardano.koiosToken) headers.authorization = `Bearer ${config.cardano.koiosToken}`;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.cardano.koiosUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Koios ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${config.cardano.koiosUrl}${path}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Koios ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export interface AddressInfo {
  address: string;
  balance: string;
  utxo_set: Array<{
    tx_hash: string;
    tx_index: number;
    value: string;
    block_time: number;
    asset_list: Array<{ policy_id: string; asset_name: string; quantity: string }> | null;
  }>;
}

export async function addressInfo(address: string): Promise<AddressInfo | null> {
  const rows = await post<AddressInfo[]>("/address_info", { _addresses: [address] });
  return rows[0] ?? null;
}

export interface TxStatus {
  tx_hash: string;
  num_confirmations: number | null;
}

export async function txStatus(txHash: string): Promise<TxStatus | null> {
  const rows = await post<TxStatus[]>("/tx_status", { _tx_hashes: [txHash] });
  return rows[0] ?? null;
}

/** UTxOs received by an address, newest first — the deposit watcher's input. */
export async function addressUtxos(address: string): Promise<AddressInfo["utxo_set"]> {
  const info = await addressInfo(address);
  return info?.utxo_set ?? [];
}

export interface TipInfo { block_no: number; epoch_no: number; block_time: number }

export async function tip(): Promise<TipInfo> {
  const rows = await get<TipInfo[]>("/tip");
  if (!rows[0]) throw new Error("Koios returned no tip");
  return rows[0];
}

export interface TxOutput {
  value: string;
  tx_index: number;
  asset_list: Array<{ policy_id: string; asset_name: string; quantity: string }> | null;
  payment_addr: { bech32: string } | null;
}

export interface TxInfo {
  tx_hash: string;
  block_height: number | null;
  tx_timestamp: number;
  outputs: TxOutput[];
}

export async function txInfo(txHash: string): Promise<TxInfo | null> {
  const rows = await post<TxInfo[]>("/tx_info", { _tx_hashes: [txHash] });
  return rows[0] ?? null;
}
