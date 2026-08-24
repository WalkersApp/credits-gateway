// Conversion is the step that turns external stablecoin liquidity into Cardano
// settlement liquidity. This gateway does not execute it: an operator performs
// the conversion outside the system and books what happened, and the reserve is
// then re-read from the chain. Saying so plainly is the point of this file — a
// reviewer should not have to guess whether a bridge is wired up.

export const CONVERSION = {
  executedByGateway: false,

  productionProvider:
    "to be selected and declared before mainnet pilot deployment",

  trigger:
    "The free reserve for a settlement asset falls below its minimum threshold, or a planned withdrawal " +
    "would take it there.",

  operatorAction:
    "The treasury converts external stablecoin liquidity into the Cardano settlement asset using the " +
    "declared external route, then sends it to the settlement vault.",

  recorded: [
    "source network",
    "source asset and amount",
    "provider used",
    "destination settlement asset",
    "expected amount",
    "actual amount received",
    "external reference or transaction",
    "status and timestamps",
  ],

  statuses: ["planned", "processing", "completed", "failed"],

  // The important control: marking a rebalance "completed" does not create
  // settlement capacity. Capacity comes from the vault balance read back off
  // the chain, so a wrong or optimistic admin entry cannot fund a payout.
  completionRule:
    "Settlement capacity is taken from the vault's on-chain balance, read independently of any rebalance " +
    "record. Marking a rebalance completed does not by itself allow a payout.",
};

// Deposits and settlements are not symmetrical, and the asymmetry is the point:
// value may arrive from several chains, but it only ever leaves on Cardano.
export const SETTLEMENT_DIRECTION = {
  depositRoutes:
    "Deposits may arrive from any supported source: Cardano preprod, Ethereum Sepolia, or an exchange " +
    "withdrawal booked in by an admin. These are inbound routes only.",
  withdrawalDestinations:
    "Settlement withdrawals leave on Cardano only. The production settlement assets are USDM and USDCx on " +
    "Cardano; this preprod deployment settles tADA. No other chain and no other asset is a payout destination.",
  rule:
    "A source chain being supported for deposits never makes it a withdrawal destination. There is no payout " +
    "path in this gateway to Ethereum, to an exchange, or to any non-Cardano asset.",
};

// The conversion walked through with numbers, because the abstract description
// invites the wrong reading: that each deposit is converted individually and
// immediately. It is not. Credits are issued from the validated deposit; the
// settlement reserve is topped up separately, on thresholds.
export const CONVERSION_EXAMPLE = {
  headline: "100 USDC deposited, 50 credits later redeemed",
  steps: [
    "A user sends 100 USDC on a supported deposit route and submits the transaction hash.",
    "The gateway reads the source chain and validates what actually arrived — 100 USDC, not a declared amount.",
    "100 credits are issued to the account, minus any configured deposit fee (currently none). The deposited USDC stays where it landed; nothing is converted at this moment.",
    "The treasury monitors the Cardano settlement reserve against its per-asset thresholds. Conversion of external liquidity into the Cardano settlement asset happens when a threshold is crossed — in batches, on the treasury's schedule, not once per deposit.",
    "The user later requests a withdrawal of 50 credits. The fee is 0.25 credits flat + 0.50% = 0.5 credits, leaving 49.5.",
    "The gateway checks the free reserve can cover 49.5, locks 50 credits, then builds, signs and submits a Cardano transaction paying 49.5 of the settlement asset to the user's Cardano address.",
    "Once the transaction is confirmed on chain the locked credits are consumed. In production the payout asset is USDM or USDCx from the settlement reserve; on this preprod deployment it is tADA.",
  ],
  notConverted:
    "No deposit is converted one-for-one at deposit time, and no conversion is triggered by an individual " +
    "deposit. Credits are an accounting claim issued on validation; the reserve that settles them is managed " +
    "separately against thresholds. Conflating the two would describe a bridge, which this is not.",
};
