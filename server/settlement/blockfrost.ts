// Blockfrost preprod client. Used as the Lucid provider when a project id is
// configured, and as a second opinion on confirmations when Koios is unreachable
// — settlement should not stall because one indexer is having a bad day.

import { config } from "../config.js";

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(`${config.cardano.blockfrostUrl}${path}`, {
    headers: { project_id: config.cardano.blockfrostProjectId },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blockfrost ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export function blockfrostConfigured(): boolean {
  return Boolean(config.cardano.blockfrostProjectId);
}

/** Confirmations for a transaction, or null if Blockfrost has not seen it. */
export async function txConfirmations(txHash: string): Promise<number | null> {
  const tx = await get<{ block_height: number }>(`/txs/${txHash}`);
  if (!tx) return null;
  const tip = await get<{ height: number }>("/blocks/latest");
  if (!tip) return null;
  return Math.max(0, tip.height - tx.block_height + 1);
}
