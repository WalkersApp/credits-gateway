// Settlement assets the Cardano vault can pay out.
//
// `official` means: this exact policy id is published by the issuer FOR THIS
// NETWORK. It is deliberately false for anything we could not verify, because a
// preprod token called "USDCx" costs nothing to mint and a reviewer must be able
// to tell the difference at a glance.

import { config } from "../config.js";
import type { SettlementAsset, SettlementTarget } from "../../src/shared/types.js";

/** Registered in the Cardano Foundation preprod token metadata registry
 *  (https://preprod.tokens.cardano.org/metadata/<subject>), decimals 6.
 *  We have not identified issuer documentation confirming it, so we do not call
 *  it official. */
const USDCX_PREPROD_POLICY = "31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf66";
const USDCX_ASSET_NAME_HEX = "5553444378"; // "USDCx"

const rateBps = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : fallback;
};

/** Per-asset reserve thresholds, falling back to the global defaults.
 *  e.g. RESERVE_TADA_MIN_UNITS, RESERVE_USDCX_PREPROD_TARGET_UNITS. */
function reserveFor(assetId: string) {
  const key = assetId.toUpperCase().replace(/-/g, "_");
  const read = (suffix: string, fallback: number) => {
    const v = Number(process.env[`RESERVE_${key}_${suffix}`]);
    return Number.isFinite(v) && v >= 0 ? Math.trunc(v) : fallback;
  };
  return {
    criticalUnits: read("CRITICAL_UNITS", config.reserve.criticalUnits),
    minUnits: read("MIN_UNITS", config.reserve.minUnits),
    targetUnits: read("TARGET_UNITS", config.reserve.targetUnits),
  };
}

export const SETTLEMENT_ASSETS: SettlementAsset[] = [
  {
    id: "tada",
    label: "Preprod ADA (tADA)",
    unit: "lovelace",
    decimals: 6,
    official: true,
    officialityNote:
      "The Cardano preprod network's own asset, obtained from the official testnet faucet. " +
      "It is not a stablecoin: it proves the settlement path, not the peg.",
    minSettlementUnits: 1_000_000,
    enabled: true,
    reserve: reserveFor("tada"),
  },
  {
    id: "usdcx-preprod",
    label: "USDCx (preprod)",
    unit: `${USDCX_PREPROD_POLICY}${USDCX_ASSET_NAME_HEX}`,
    decimals: 6,
    official: false,
    officialityNote:
      "A preprod asset named USDCx, registered in the Cardano Foundation preprod token metadata " +
      "registry with 6 decimals. We have not identified issuer documentation confirming this policy id " +
      "as official Circle USDCx, so it is treated as a test asset representing the USDCx settlement path.",
    minSettlementUnits: 1_000_000,
    enabled: process.env.SETTLEMENT_USDCX_ENABLED === "true",
    reserve: reserveFor("usdcx-preprod"),
  },
];

/** What we intend to settle in on mainnet. Listed so a reviewer can see the
 *  production target without us pretending it is deployed here. */
export const SETTLEMENT_TARGETS: SettlementTarget[] = [
  {
    label: "USDM",
    network: "Cardano mainnet",
    status: "production target — not deployed here",
    note:
      "Moneta publishes a mainnet policy id for USDM. We have not identified an issuer-confirmed USDM " +
      "deployment on Cardano preprod, so no USDM payout has been exercised by this deployment.",
  },
  {
    label: "USDCx",
    network: "Cardano mainnet",
    status: "production target — not deployed here",
    note:
      "USDCx exists on Cardano mainnet under a published policy id. A preprod asset named USDCx is " +
      "registered in the Cardano Foundation preprod token metadata registry, but we have not identified " +
      "issuer documentation confirming it as official Circle USDCx, so no USDCx payout has been exercised.",
  },
];

/** Credits -> settlement asset. Server-side only; the client never sends a rate. */
export const SETTLEMENT_RATE_BPS: Record<string, number> = {
  // Preprod ADA has no market price. 1 credit settles as 1 tADA purely so the
  // amounts are readable in the explorer; this is stated in the UI.
  tada: rateBps("SETTLEMENT_RATE_TADA_BPS", 10_000),
  // A dollar-denominated asset settles 1:1 with credits, before fees.
  "usdcx-preprod": rateBps("SETTLEMENT_RATE_USDCX_BPS", 10_000),
};

export function getSettlementAsset(id: string): SettlementAsset {
  const asset = SETTLEMENT_ASSETS.find((a) => a.id === id);
  if (!asset) throw new Error(`unknown settlement asset "${id}"`);
  return asset;
}

export function enabledSettlementAssets(): SettlementAsset[] {
  return SETTLEMENT_ASSETS.filter((a) => a.enabled);
}

export function explorerTxUrl(txHash: string): string {
  return `${config.cardano.explorerBase}/transaction/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${config.cardano.explorerBase}/address/${address}`;
}
