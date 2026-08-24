// Funding routes: how external value gets into the gateway.
//
// A route is only `enabled` when its verification path actually runs. Nothing
// here is aspirational — if we have not integrated a provider, its route is off
// and the architecture page says so.

import { config } from "./config.js";
import { SETTLEMENT_ASSETS } from "./settlement/assets.js";
import type { FundingRoute } from "../src/shared/types.js";

const usdcxUnit = SETTLEMENT_ASSETS.find((a) => a.id === "usdcx-preprod")!.unit;

export const FUNDING_ROUTES: FundingRoute[] = [
  {
    id: "sepolia-usdc",
    network: "ethereum-sepolia",
    networkLabel: "Ethereum Sepolia",
    asset: "USDC",
    assetDecimals: 6,
    assetIssuer: "Circle (Sepolia test USDC)",
    chainAccess: "public Sepolia JSON-RPC node",
    validation: "ERC-20 Transfer log read from the transaction receipt",
    custody: "WFIT-controlled Sepolia deposit address",
    automation: "not exercised",
    verification: "onchain_automatic",
    confirmationsRequired: config.sepolia.confirmations,
    depositAddress: config.sepolia.depositAddress || null,
    contract: config.sepolia.usdcContract,
    enabled: config.sepolia.enabled && Boolean(config.sepolia.depositAddress),
    rateBps: 10_000,
    minUnits: 100_000, // 0.1 USDC
    notes:
      "Send Circle's Sepolia test USDC to the address above, then paste the transaction hash. " +
      "The gateway reads the ERC-20 Transfer log from the receipt and credits the amount that actually arrived.",
  },
  {
    id: "cardano-preprod-ada",
    network: "cardano-preprod",
    networkLabel: "Cardano preprod",
    asset: "tADA",
    assetDecimals: 6,
    assetIssuer: "Cardano preprod network asset (testnet faucet)",
    chainAccess: "Koios preprod",
    validation: "transaction outputs paying the gateway deposit address",
    custody: "WFIT-controlled Cardano preprod deposit address",
    automation: "automatic",
    verification: "onchain_automatic",
    confirmationsRequired: config.cardanoDeposits.confirmations,
    depositAddress: config.cardanoDeposits.address || null,
    contract: "lovelace",
    enabled: config.cardanoDeposits.enabled && Boolean(config.cardanoDeposits.address),
    rateBps: 10_000,
    minUnits: 1_000_000,
    notes:
      "Preprod ADA has no market value. It is credited 1:1 so the amounts are readable end to end; " +
      "this is a test rate, not a price.",
  },
  {
    id: "cardano-preprod-usdcx",
    network: "cardano-preprod",
    networkLabel: "Cardano preprod",
    asset: "USDCx (preprod)",
    assetDecimals: 6,
    assetIssuer: "not identified — preprod registry entry only",
    chainAccess: "Koios preprod",
    validation: "native-asset outputs paying the gateway deposit address",
    custody: "WFIT-controlled Cardano preprod deposit address",
    automation: "not exercised",
    verification: "onchain_automatic",
    confirmationsRequired: config.cardanoDeposits.confirmations,
    depositAddress: config.cardanoDeposits.address || null,
    contract: usdcxUnit,
    enabled: config.cardanoDeposits.enabled && Boolean(config.cardanoDeposits.address),
    rateBps: 10_000,
    minUnits: 1_000_000,
    notes:
      "Preprod asset registered as USDCx in the Cardano Foundation preprod token registry. " +
      "Treated as a test asset representing the stablecoin path — not confirmed as official Circle USDCx.",
  },
  {
    id: "cex-manual",
    network: "cex",
    networkLabel: "Centralised exchange",
    asset: "USDC / USDT",
    assetDecimals: 6,
    assetIssuer: "Circle (USDC) / Tether (USDT), as held by the exchange",
    chainAccess: "none — no exchange API is integrated",
    validation: "an admin checks the submitted withdrawal id against the exchange record",
    custody: "the exchange, then the WFIT treasury account that receives the withdrawal",
    automation: "manual",
    verification: "manual_admin",
    confirmationsRequired: 0,
    depositAddress: null,
    contract: null,
    enabled: config.cexDeposits.enabled,
    rateBps: 10_000,
    minUnits: 1_000_000,
    notes:
      "Withdraw from the exchange, then submit the exchange, asset, network, amount and the exchange's " +
      "withdrawal id or transaction hash. An admin verifies it against the exchange record and approves. " +
      "Credits are only issued on approval.",
  },
];

export function getRoute(id: string): FundingRoute | undefined {
  return FUNDING_ROUTES.find((r) => r.id === id);
}

export function enabledRoutes(): FundingRoute[] {
  return FUNDING_ROUTES.filter((r) => r.enabled);
}
