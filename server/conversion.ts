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
