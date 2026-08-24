# Catalyst answer — WFIT Stablecoin Gateway

This is the reviewer-facing answer for the Stablecoin Gateway. It states what has been built and exercised,
what has not, and how production settlement liquidity is intended to be sourced. Everything here is checkable
against the repository, the live preprod deployment, or a public block explorer.

Nothing in this document claims an integration that does not exist.

## 1. Scope

The gateway is a **standalone financial infrastructure layer** — deposit validation, credit accounting and
Cardano settlement. It carries no application logic.

| | |
|---|---|
| **WChronicles** | the ecosystem/application — a separate, live product with its own users, database and wallets |
| **WFIT Stablecoin Gateway** | reusable financial infrastructure — this repository |

It does not replace WChronicles, it is not integrated into WChronicles production, it runs separately on
Cardano preprod with its own database, process and signing key, and WChronicles production is untouched by it.

## 2. What the pilot demonstrates

Exercised end to end on the preprod deployment, with transaction hashes in the README and on `/evidence`:

- **Deposit validation** — read from the source chain and credited from the amount that actually arrived,
  never from a declared amount.
- **Credit accounting** — append-only ledger, unique idempotency keys, and a conservation check that halts
  settlement on any drift.
- **Cardano settlement flow** — build, sign, submit, confirm, reconcile, from the gateway's own vault key.
- **Reserve protection** — per-asset thresholds, committed-versus-free liquidity, settlements refused before
  any credits are locked.
- **Failure handling** — rejected deposits, duplicate submissions, pre-broadcast refunds, and unproven submits
  held for review with credits locked rather than guessed at.
- **Operational visibility** — `/architecture` and `/evidence` rendered from this deployment's own
  configuration and records.

## 3. What the pilot does not demonstrate

- **Production USDM settlement.** No USDM payout has been made by this deployment.
- **Production USDCx settlement.** No USDCx payout has been made by this deployment.
- **Automated liquidity conversion.** Conversion and rebalancing are operator processes that the gateway
  records, not performs.
- **Exchange integrations.** The exchange funding route is manual and admin-approved. No exchange API is
  integrated.

The settlement asset exercised is **tADA**, the preprod network's own asset. It evidences the settlement
mechanism, not stablecoin peg behaviour and not issuer integration.

## 4. Settlement assets — registered, enabled, exercised

These are three independent states, and conflating them is how stablecoin support gets overstated.
**Registered** means the settlement-asset registry knows the asset. **Enabled** means this deployment will
select it for a payout. **Exercised** means a transaction exists.

| Asset | Registered | Enabled | Exercised |
|---|---|---|---|
| Preprod ADA (tADA) | yes | yes | **yes** |
| USDCx preprod registry asset | yes | no — disabled by default | no |
| USDM, Cardano mainnet | production target | no | no |
| USDCx, Cardano mainnet | production target | no | no |

**USDM and USDCx are production settlement targets at the same level of support.** They differ only in how the
reserve would be sourced, not in how the gateway settles them — the registry treats them identically, and
neither has been exercised. Neither is designated primary. That designation belongs at pilot start, once the
treasury entity and jurisdiction are decided, and will be recorded then.

The preprod asset named USDCx is registered in the Cardano Foundation preprod token metadata registry with 6
decimals. We have not identified issuer documentation confirming it as official Circle USDCx, so it is treated
as a test asset and disabled by default. We have not identified an issuer-confirmed USDM deployment on Cardano
preprod.

## 5. Production settlement route — candidate, not integrated

WFIT is not building a bridge. Reaching Cardano settlement liquidity is a **three-leg process**, and no single
provider performs all of it.

> **None of the routes below is integrated. No account, agreement, onboarding or API access exists with any
> party named, and none has been contacted. These are candidate routes identified by desk research.**

**Leg 1 — Normalisation (treasury, manual).** External stablecoin liquidity (USDC, USDT, or USDC on another
chain) is converted to USDC on a chain the Cardano entry route accepts. Performed by an operator through an
exchange or an issuer fiat account. No exchange API is integrated and none is claimed.

**Leg 2 — Cardano entry (third-party issuer infrastructure).** USDC is deposited into Circle's xReserve
contract and USDCx is minted to a WFIT-controlled Cardano address. Attestation is performed by Circle and by
the Cardano-side network operator. **WFIT would be a user of this publicly available route, not an operator of
it, and holds no partner or API access to it.** The operator documents a reverse path from Cardano back to
USDC; we have not exercised it.

**Leg 3 — Settlement asset.** Where USDM is required, it is sourced either by an on-chain swap from USDCx on a
Cardano DEX, or by direct issuance from the USDM issuer — Moneta, which states that it mints and redeems in
licensed US states, or NBX, which states that it is the EEA co-issuer under MiCA. Which route applies depends
on the treasury entity's jurisdiction and banking access. That is an open pilot decision.

Regulatory descriptions above are the providers' own statements about themselves. We report them; we do not
certify them.

Of these legs, the Cardano entry route has the fewest onboarding preconditions — wallets, rather than a
banking relationship or issuer onboarding. That is an observation about preconditions, not a selection, and it
does not make either settlement asset primary.

**Why no provider has been contracted yet.** Provider selection depends on the treasury entity and
jurisdiction decision, which is unresolved. Contracting before that decision would commit the pilot to a route
that the entity may not be eligible to use. Identifying the routes closes the question of *what* the route is;
contracting them is pilot work.

**Sizing constraint.** Cardano stablecoin liquidity is finite, and stable-pair pool depth is a small fraction
of network supply. Settlement sizing and reserve thresholds are set against depth observed at the time of
operation, not against theoretical capacity.

## 6. Gap responses

| Gap raised | Response |
|---|---|
| Interoperability providers not identified | Identified as candidate routes in §5, with integration status stated separately from identification. |
| Conversion mechanism not identified | A three-leg process, described in §5. The gateway does not execute conversion; it records the operation and verifies the result against the chain. |
| Custody model not identified | Source-chain deposits at WFIT-controlled addresses per chain; credits are database accounting only; the Cardano reserve is a **custodial hot wallet** — no smart-contract vault, no multi-signature. Stated as such, not described as non-custodial. |
| Liquidity / rebalancing process not identified | Reserve thresholds per settlement asset, committed-versus-free accounting, and a rebalance record capturing source network, source asset and amount, provider, destination asset, expected amount, actual amount, external reference, status and timestamps. Settlement capacity comes from the vault's on-chain balance, read independently of any rebalance record. |
| Failure / refund logic not identified | Full deposit and withdrawal outcome tables in the README and on `/architecture`; pre-broadcast failures release credits, unproven submits hold them. |

## 7. Technology readiness

**TRL 5.** Core integrated components validated in a relevant environment: real on-chain deposit verification,
idempotent credits issuance, accounting integrity controls, reserve checks, withdrawal orchestration, failure
handling and real Cardano preprod settlement, exercised end to end.

The pilot extends this into production USDM/USDCx settlement liquidity, a contracted production conversion
route, and the broader WFIT ecosystem.

## 8. What remains open

- The treasury entity and jurisdiction, which decides the Leg 3 sourcing route.
- Contracting and onboarding for Legs 1 and 3.
- Whether USDM or USDCx is designated primary at pilot start.
- The production vault and key policy, including whether the custodial hot wallet is replaced before mainnet.
- No third-party security audit of this codebase has been performed.
