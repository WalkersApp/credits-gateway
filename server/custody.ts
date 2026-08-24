// The custody chain, hop by hop. Written as data rather than prose because the
// only question that matters — "who can move the funds at this point" — has to
// be answerable for every step without reading a paragraph.

import { config } from "./config.js";

export interface CustodyHop {
  stage: string;
  holds: string;
  controlledBy: string;
  model: "user-controlled" | "custodial" | "third party" | "accounting only";
  note: string;
}

export function custodyChain(): CustodyHop[] {
  return [
    {
      stage: "User wallet",
      holds: "the user's own stablecoin or ADA, before any deposit",
      controlledBy: "the user",
      model: "user-controlled",
      note: "The gateway has no visibility of or access to this wallet. Nothing here is custodied by WFIT.",
    },
    {
      stage: "Deposit address",
      holds: "deposited value on its source chain",
      controlledBy: "WFIT, one address per source chain",
      model: "custodial",
      note:
        "Custodial from the moment the deposit lands. The exchange route has no gateway-controlled address at " +
        "all — funds land in a WFIT treasury account at the exchange, and an admin books them in.",
    },
    {
      stage: "Credits ledger",
      holds: "no funds — an accounting claim on the gateway",
      controlledBy: "the gateway database, append-only",
      model: "accounting only",
      note:
        "Credits are not a token, not a stablecoin and not transferable between users. They leave the system " +
        "only through a settlement transaction.",
    },
    {
      stage: "Treasury / rebalancing layer",
      holds: "external liquidity in transit between the deposit side and the Cardano reserve",
      controlledBy: "the WFIT treasury operator, outside this system",
      model: "custodial",
      note:
        "The gateway does not execute this step. It records what the operator did and verifies the result " +
        "against the vault's on-chain balance. Third-party routes used here are candidates, none integrated.",
    },
    {
      stage: "Cardano settlement vault",
      holds: "the settlement reserve — tADA here, USDM/USDCx in production",
      controlledBy: `WFIT, single signing key: ${config.cardano.vaultAddress || "not configured"}`,
      model: "custodial",
      note:
        "A custodial hot wallet. No smart-contract vault and no multi-signature scheme in this implementation, " +
        "and we do not describe it as non-custodial. The key is held server-side outside the repository, mode " +
        "600, never logged and never returned by an API. The production vault and its key policy are to be " +
        "declared before mainnet.",
    },
    {
      stage: "User Cardano wallet",
      holds: "the settled payout",
      controlledBy: "the user",
      model: "user-controlled",
      note:
        "The destination address is supplied by the user and validated for the network before anything is " +
        "locked. Once the settlement transaction confirms, WFIT has no further control over the funds.",
    },
  ];
}

export const CUSTODY_SUMMARY = {
  status: "custodial",
  statement:
    "Between the deposit landing and the settlement transaction confirming, WFIT holds the funds. This is a " +
    "custodial model and is stated as such — the gateway is not, and is not described as, non-custodial.",
  userControlled: "the user's own wallet before deposit, and their Cardano wallet after settlement",
  wfitControlled: "the per-chain deposit addresses, the treasury, and the Cardano settlement vault",
  productionNote:
    "Production vault addresses and their key policy are to be declared before mainnet pilot deployment. The " +
    "address shown on this deployment is a Cardano preprod vault holding no mainnet value.",
};
