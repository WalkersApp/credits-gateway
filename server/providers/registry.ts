// Liquidity provider routes — DECLARED, NOT INTEGRATED.
//
// Read this file as an interface definition, not as a capability list. No
// provider here is connected, credentialed, or callable. The gateway has never
// executed a conversion through any of them, and `executeRoute` below exists
// specifically to fail loudly if some future caller assumes otherwise.
//
// The reason to write it down now: a pilot integration has to satisfy a shape,
// and a reviewer should be able to see that shape — and see that it is empty —
// rather than take our word for what is or is not wired up.

import { badRequest } from "../errors.js";
import type { LiquidityProviderRoute } from "../../src/shared/types.js";

/**
 * The contract a real integration would have to implement during the pilot
 * phase. It is deliberately unimplemented: there is no class in this repository
 * that satisfies it.
 */
export interface LiquidityProvider {
  readonly route: LiquidityProviderRoute;
  /** Indicative quote for converting `sourceAmount` into the settlement asset. */
  quote(sourceAmount: string): Promise<{ expectedAmount: string; expiresAt: number }>;
  /** Execute the conversion and return the provider's own reference. */
  execute(sourceAmount: string, reference: string): Promise<{ reference: string }>;
  /** Poll a previously executed conversion. */
  status(reference: string): Promise<{ status: "processing" | "completed" | "failed"; actualAmount: string | null }>;
}

/**
 * Candidate routes for the pilot phase. Each one names a real product, which is
 * exactly why the status field matters: naming a provider is not integrating it.
 */
export const LIQUIDITY_ROUTES: LiquidityProviderRoute[] = [
  {
    id: "circle-usdc",
    label: "Circle / USDC route",
    sourceNetwork: "Ethereum (or another Circle-supported chain)",
    sourceAsset: "USDC",
    destinationAssetId: "usdcx",
    destinationNetwork: "Cardano mainnet",
    status: "future_integration",
    requirements: [
      "a Circle business account and API credentials",
      "an issuer-confirmed USDCx policy id on the target network",
      "a documented path from Circle-held USDC to a Cardano-native settlement asset",
      "treasury and key-custody arrangements for the receiving vault",
    ],
    note:
      "No Circle account, credential or API call exists in this codebase. This route is a target for the " +
      "pilot phase, not a present capability.",
  },
  {
    id: "usdm-issuer",
    label: "USDM issuer route",
    sourceNetwork: "off-chain settlement with the issuer",
    sourceAsset: "USD",
    destinationAssetId: "usdm",
    destinationNetwork: "Cardano mainnet",
    status: "future_integration",
    requirements: [
      "a Moneta (USDM) issuance or distribution relationship",
      "KYB onboarding and an agreed mint/redeem process",
      "confirmation of the mainnet USDM policy id from issuer documentation",
    ],
    note:
      "Moneta publishes USDM on Cardano mainnet. We have no relationship with the issuer and no USDM has " +
      "been held, minted or settled by this gateway.",
  },
  {
    id: "cardano-dex",
    label: "Cardano DEX liquidity route",
    sourceNetwork: "Cardano mainnet",
    sourceAsset: "ADA",
    destinationAssetId: "usdm",
    destinationNetwork: "Cardano mainnet",
    status: "future_integration",
    requirements: [
      "a selected DEX or aggregator and its published contracts",
      "slippage, depth and failure-handling policy for treasury-sized orders",
      "a decision on whether on-chain swapping is acceptable for reserve funding at all",
    ],
    note:
      "An on-chain swap route is listed for completeness. It has not been selected, integrated or exercised.",
  },
];

export function listLiquidityRoutes(): LiquidityProviderRoute[] {
  return LIQUIDITY_ROUTES;
}

export function getLiquidityRoute(id: string): LiquidityProviderRoute | undefined {
  return LIQUIDITY_ROUTES.find((r) => r.id === id);
}

/**
 * There is no provider implementation to return, and calling this is a bug.
 *
 * This is the guard that keeps the registry honest: if a future change starts
 * treating a declared route as an executable one, it fails here instead of
 * silently pretending a conversion happened.
 */
export function executeRoute(routeId: string): never {
  const route = getLiquidityRoute(routeId);
  throw badRequest(
    route
      ? `The "${route.label}" route is a declared future integration. No provider is connected, so the ` +
          "gateway cannot execute a conversion. Rebalances are performed by the treasury operator and " +
          "booked into the gateway as records."
      : `Unknown liquidity route "${routeId}".`,
    "provider_not_integrated",
  );
}

/** Stated once, in code, so the API and the docs cannot drift apart on it. */
export const PROVIDER_INTEGRATION_STATUS = {
  integratedProviders: [] as string[],
  executedConversions: 0,
  statement:
    "No external liquidity provider is integrated with this gateway. Reserve top-ups on preprod were " +
    "performed manually from the Cardano testnet faucet and booked as rebalance records. Provider " +
    "selection and integration are pilot-phase work.",
};
