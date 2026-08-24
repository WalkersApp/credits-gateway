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
- **Reserve protection** — per-asset thresholds, committed-versus-free liquidity, outstanding credit
  liability tracked against on-chain settlement capacity, settlements refused before any credits are locked.
- **Preprod automated settlement demonstration using test liquidity** — the same path settling a
  dollar-denominated native asset (a preprod **tUSDM test asset**) rather than only tADA, which exercises
  native-asset coin selection and the min-UTxO ADA that leaves the vault with the token. Test liquidity only:
  **not production USDM**, and production USDM/USDCx settlement depends on final liquidity, treasury and
  provider setup during the pilot phase.
- **Reproducible settlement demonstration** — `npm run demo:settlement` re-runs the full path unattended
  (on-chain deposit → validation → credits → withdrawal → vault signature → submission → confirmation) and
  then verifies the resulting transaction against Koios independently of the gateway, exiting non-zero if it
  cannot. A recorded run, with both transaction hashes, is in `docs/preprod-settlement-run.json`.
- **Rebalancing framework** — a free reserve below its minimum raises a rebalance *request* automatically, at
  most one open per asset. The gateway never moves liquidity itself.
- **Failure handling** — rejected deposits, duplicate submissions, pre-broadcast refunds, and unproven submits
  held for review with credits locked rather than guessed at.
- **Operational visibility** — `/architecture` and `/evidence` rendered from this deployment's own
  configuration and records.

## 3. What the pilot does not demonstrate

- **Production USDM settlement.** No production USDM payout has been made by this deployment. A preprod
  **tUSDM test asset** has been settled to exercise the path for a dollar-denominated native asset; its
  on-chain metadata is self-asserted, the subject is absent from the Cardano Foundation preprod token
  registry, and no issuer relationship exists. Test liquidity is not production liquidity.
- **Production USDCx settlement.** No USDCx payout has been made by this deployment.
- **Automated liquidity conversion.** The gateway raises rebalance requests and records outcomes; the
  conversion itself is an operator process it does not perform.
- **Provider integrations.** `server/providers/registry.ts` declares the Circle/USDC, USDM issuer and Cardano
  DEX routes as typed interfaces marked `future_integration`, together with the `LiquidityProvider` interface
  a pilot integration would implement. None is connected: no implementation of that interface exists in the
  repository, no credential and no API call. The registry records zero integrated providers and zero executed
  conversions, and the function that would execute a route raises `provider_not_integrated` by design, so a
  later change cannot quietly turn a declaration into an implied capability.
- **Exchange integrations.** The exchange funding route is manual and admin-approved. No exchange API is
  integrated.

The settlement asset exercised is **tADA**, the preprod network's own asset. It evidences the settlement
mechanism, not stablecoin peg behaviour and not issuer integration.

## 3a. What a reviewer can test on preprod

The deployment is open at <https://wfit-gateway.anchorflow.cloud> — register, no invitation needed. It is
Cardano preprod throughout, so nothing involves real value.

1. Get preprod tADA from the [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet).
2. Send it to the gateway deposit address `addr_test1vrldq43s4xqjnak2s04dg08v2w04cj62llxnqne683rsrpqjzdk6l`
   and paste the transaction hash into **Fund credits**. Type a wrong amount deliberately: the gateway credits
   what it observed on chain, not what was typed.
3. Watch the deposit move `pending → confirming → credited`, then resubmit the same hash — the original record
   comes back and a duplicate counter increments.
4. Request a withdrawal to your own preprod address. The quote is computed server-side; a rate sent by the
   browser is ignored.
5. Check the resulting transaction hash in a public Cardano preprod explorer, and check the balance dropped by
   exactly the credits used.
6. Exercise the failure paths: a hash paying a different address, an amount below the route minimum, a
   withdrawal above the balance, a malformed destination. Each is refused with a reason, without moving credits.
7. Read `/architecture` and `/evidence` — both render from this deployment's own configuration and records.

**Proven, and checkable by a reviewer without our cooperation:** on-chain deposit validation, credit issuance
from the observed amount, duplicate prevention, reserve checks, the Cardano settlement transaction, and the
credits reconciliation that follows it. Every hash resolves in a public explorer.

**Not proven, and not testable here because it does not exist:** a USDM or USDCx payout, an automated
conversion route, and an exchange API.

## 3b. Deposit routes in, Cardano settlement out

Deposits and withdrawals are not symmetrical.

- **Deposit routes are inbound only** — Cardano preprod, Ethereum Sepolia, and exchange withdrawals booked in
  by an admin.
- **Settlement destinations are Cardano only.** The production settlement assets are **USDM and USDCx on
  Cardano**; this preprod deployment settles tADA.

A source chain being supported for deposits never makes it a withdrawal destination. There is no payout path
in this gateway to Ethereum, to an exchange, or to any non-Cardano asset — none is implemented, none is
configured, and none is planned.

```
Ethereum Sepolia · Cardano preprod · exchange withdrawal
  ↓  deposit — inbound only
WFIT credits ledger
  ↓  withdrawal — Cardano only
USDM / USDCx on Cardano in production   (tADA on this preprod deployment)
```

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

## 5a. Conversion mechanism, worked through

The abstract description invites the wrong reading — that each deposit is converted individually and
immediately. It is not.

**100 USDC deposited, 50 credits later redeemed:**

1. A user sends 100 USDC on a supported deposit route and submits the transaction hash.
2. The gateway reads the source chain and validates what actually arrived — 100 USDC, not a declared amount.
3. **100 credits are issued**, minus any configured deposit fee (currently none). The deposited USDC stays
   where it landed; **nothing is converted at this moment**.
4. The treasury monitors the Cardano settlement reserve against its per-asset thresholds. Conversion into the
   Cardano settlement asset happens **when a threshold is crossed** — in batches, on the treasury's schedule,
   **not once per deposit**.
5. The user requests a withdrawal of 50 credits. The fee is 0.25 flat + 0.50% = 0.5 credits, leaving 49.5.
6. The gateway checks the free reserve covers 49.5, locks 50 credits, then builds, signs and submits a Cardano
   transaction paying 49.5 of the settlement asset to the user's Cardano address.
7. On confirmation the locked credits are consumed. In production the payout asset is **USDM or USDCx** from
   the settlement reserve; on this preprod deployment it is tADA.

**No deposit is converted one-for-one at deposit time, and no conversion is triggered by an individual
deposit.** Credits are an accounting claim issued on validation; the reserve that settles them is managed
separately against thresholds. Conflating the two would describe a bridge, which this is not.

The same sequence ran for real on this deployment with tADA in place of USDC: 120 in, 120 credits, 50
redeemed, 49.5 settled — hashes in the README and on `/evidence`.

## 5b. Custody chain

```
User wallet                     the user's own funds        user-controlled
  ↓  deposit
Deposit address                 one per source chain        WFIT — custodial
  ↓  validated, credits issued
Credits ledger                  no funds, an accounting claim on the gateway
  ↓  redemption requested
Treasury / rebalancing layer    external liquidity in transit
                                WFIT treasury operator, outside this system — custodial
  ↓  reserve topped up
Cardano settlement vault        tADA here, USDM / USDCx in production
                                WFIT, single signing key — custodial hot wallet
  ↓  settlement transaction confirmed
User Cardano wallet             the settled payout          user-controlled
```

| Stage | Controlled by | Model |
|---|---|---|
| User wallet, before deposit | the user | user-controlled |
| Deposit address, one per source chain | WFIT | custodial |
| Credits ledger | the gateway database, append-only | accounting only — holds no funds |
| Treasury / rebalancing layer | the WFIT treasury operator, outside this system | custodial |
| Cardano settlement vault | WFIT, single signing key | custodial hot wallet |
| User Cardano wallet, after settlement | the user | user-controlled |

**Status: custodial.** Between the deposit landing and the settlement transaction confirming, WFIT holds the
funds. The gateway is not, and is not described as, non-custodial.

- **Preprod vault address:** `addr_test1vz3scr56jxyl7qez7c8m8z75r73vuhhs0kjl8tjp06yqvjga9h60a` — public and
  checkable, holding no mainnet value. It is a custodial hot wallet: no smart-contract vault, no
  multi-signature scheme.
- The signing key is held server-side outside the repository, mode 600, read once by the gateway process. It
  is never logged, never returned by an API and never reaches the browser.
- **Production vaults and their key policy are to be declared before mainnet pilot deployment**, including
  whether the custodial hot wallet is replaced.

## 5c. Liquidity and rebalancing — operational rules

| | Today, on this deployment | Pilot |
|---|---|---|
| Reserve monitoring | on-chain balance read per settlement asset, free = balance − committed | unchanged, plus alerting |
| Thresholds | configured per asset in base units: critical / minimum / target | unchanged, sized against observed pool depth |
| Rebalance trigger | a rebalance **request** is raised automatically when free reserve falls below minimum, at most one open per asset; a person decides what to do about it | unchanged, plus alerting and provider routing |
| Conversion itself | **a manual treasury action, entirely outside this system** | provider-integrated, with quote and slippage pre-checks and policy-bounded signing |
| Recording | an admin books the rebalance and what actually arrived | written automatically from the provider response |
| Verification | the vault's on-chain balance, read independently of the record | plus on-chain verification of the mint transaction, and reverse-leg monitoring |

**The boundary, precisely.** A background job creates rebalance *requests* — a `planned` record with no
provider and no source assigned, because the gateway knows the reserve is short but not where liquidity should
come from. **No automated job moves liquidity, executes a conversion, contacts a provider, or completes a
rebalance.** A request is a signal for a human; everything after it is a treasury action outside this system.
Marking a rebalance completed grants no settlement capacity either: capacity is re-read from the vault's
on-chain balance, so a top-up booked but never received leaves the reserve exactly as short as it was, and
there is a test asserting that. Percentages, provider names and pool sizes are deliberately not quoted: none
has been selected, and any figure would date.

Threshold semantics, per settlement asset, where free = on-chain balance − committed to unsettled withdrawals:
`free ≥ target` healthy · `minimum ≤ free < target` monitor · `critical ≤ free < minimum` rebalance required ·
`free < critical` critical · `free < the requested settlement` that settlement is blocked before any credits
are locked.

## 5d. Failure and refund state machine

Happy path, end to end:

```
Deposit submitted            pending
  ↓ seen on chain
Waiting for confirmations    confirming
  ↓ confirmation target met
Validated                    confirmed
  ↓ credits issued once, from the observed amount
Credits in the ledger        credited
  ↓ withdrawal requested, credits locked
Withdrawal requested         pending → processing
  ↓ built, signed, broadcast
On the network               submitted
  ↓ seen on chain, locked credits consumed
Settled                      confirmed
```

| Deposit state | Meaning | Can move to |
|---|---|---|
| `pending` | submitted, nothing seen on chain yet (or awaiting admin review on the exchange route) | `confirming` · `rejected` · `failed` |
| `confirming` | found and paying the deposit address; waiting for the confirmation target | `confirmed` · `rejected` |
| `confirmed` | validated at or above the target, from the observed amount | `credited` |
| `credited` | credits issued once — terminal, happy path | — |
| `rejected` | refused by validation or by an admin, reason stored | — terminal, 0 credits |
| `failed` | validation could not complete | — terminal, 0 credits |

| Withdrawal state | Meaning | Can move to |
|---|---|---|
| `pending` | requested and quoted; credits locked, settlement not started | `processing` · `failed` |
| `processing` | building, balancing and signing the Cardano transaction | `submitted` · `failed` |
| `submitted` | broadcast, waiting for confirmations | `confirmed` · `manual_review` |
| `confirmed` | on chain; locked credits consumed — terminal, happy path | — |
| `failed` | failed before broadcast, provably nothing sent | `refunded` |
| `refunded` | locked credits released back to available | — terminal |
| `manual_review` | submit outcome unproven; the transaction may still confirm | — held, credits stay locked |

**Failure cases and what happens to the money:**

| Case | Where it is caught | Result |
|---|---|---|
| Unsupported or unrecognised asset | deposit validation | rejected, 0 credits |
| Missing confirmations | deposit validation | held at `confirming`, 0 credits until the target is met |
| Duplicate deposit | unique index on `(network, txHash)` | original record returned, issued once |
| Insufficient liquidity | reserve check at request time | refused before any credits are locked |
| Failed Cardano transaction | build / sign / first submit | `failed`, nothing broadcast, credits released |
| Unprovable Cardano submit | post-submit | `manual_review`, credits stay locked |

**Refund behaviour:**

- **Credits** — a refund releases locked credits back to available. It happens only where the settlement
  transaction was provably never broadcast, and it is idempotent: a second refund call is a no-op.
- **Deposits** — **the gateway does not refund deposits, and no code path exists to do so.** A rejected
  deposit issues zero credits and the funds remain at the deposit address under operator control. Returning
  them to the sender is an off-system treasury action, not a gateway function.
- **Unproven settlements** — never auto-refunded. Refunding a transaction that later confirms would pay twice.

The rule underneath all of it: everything that can fail happens *before* broadcast, so those cases release
credits safely. A rejection on a *resubmit* proves nothing — if our transaction was applied, its inputs are
already spent and the node rejects the duplicate.

## 6. Gap responses

| Gap raised | Response | Where |
|---|---|---|
| Preprod demonstration unclear | A step-by-step walkthrough a reviewer can run themselves, and an end-to-end trace on `/evidence` chaining one deposit to one settlement transaction. | §3a, `/evidence` §2–3 |
| Interoperability providers not identified | Identified as candidate routes, with integration status stated separately from identification. None is integrated or contacted. | §5 |
| Conversion mechanism not identified | A three-leg process, plus a worked numeric example showing that credits are issued on validation while the reserve is topped up separately on thresholds — not per deposit, not instantly. | §5, §5a |
| Withdrawal destinations unclear | Settlement withdrawals leave on Cardano only, in USDM/USDCx in production and tADA here. External chains and assets are deposit routes only; no payout path to them exists. | §3b |
| Custody model not identified | A per-hop custody chain: user wallet → deposit address → credits ledger → treasury → Cardano vault → user wallet, each row naming who controls it. Custodial throughout the middle; the Cardano reserve is a **custodial hot wallet** — no smart-contract vault, no multi-signature. Stated as such, not described as non-custodial. Production vaults to be declared before mainnet. | §5b |
| Liquidity / rebalancing process not identified | Reserve thresholds per settlement asset, committed-versus-free accounting, a today-versus-pilot rule table, and a rebalance record capturing source network, source asset and amount, provider, destination asset, expected amount, actual amount, external reference, status and timestamps. Settlement capacity comes from the vault's on-chain balance, read independently of any rebalance record. | §5c |
| Failure / refund logic not identified | A state machine for both deposits and withdrawals with the transitions out of every state, the named failure cases, and what happens to the money in each. Pre-broadcast failures release credits; unproven submits hold them; deposits are never refunded by the gateway and no code path exists to do so. | §5d |
| TRL justification | TRL 5, with the specific integrated components validated in a relevant environment listed and each one checkable against the live deployment. | §7 |

## 7. Technology readiness

**TRL 5.** Core integrated components validated in a relevant environment: real on-chain deposit verification,
idempotent credits issuance, accounting integrity controls, reserve and liability tracking, withdrawal
orchestration, failure handling and real Cardano preprod settlement, exercised end to end — and reproducible
on demand rather than only historical, via an unattended demonstration that verifies its own result against a
third-party indexer.

The pilot extends this into production USDM/USDCx settlement liquidity, a contracted production conversion
route, and the broader WFIT ecosystem.

**Why not lower.** TRL 4 would mean components validated in a laboratory — mocks, simulated chains, unit tests
alone. That is not what this is. The components are integrated with each other and run against a real Cardano
network with real transaction construction, signing, submission and confirmation. The deposit that funded the
credits and the transaction that settled them both exist on preprod and resolve in a public explorer.

**Why not higher.** TRL 6 would mean the system demonstrated in an operational environment. It is not: there
is no mainnet deployment, no production settlement asset has been paid out, the conversion route is a manual
treasury process with no provider contracted, the exchange route has no API, and no third-party security audit
has been performed. Claiming TRL 6 would require exactly the work this pilot proposes to do.

**What "relevant environment" means here.** Cardano preprod is the same protocol, the same transaction format,
the same signing scheme and the same indexer APIs as mainnet, differing in the value at stake and the assets
available. That makes it the right environment to validate a settlement engine, and the wrong environment to
validate a stablecoin peg or an issuer relationship — which is why neither is claimed.

## 7a. Preprod deployment validates the execution path

The preprod deployment validates the gateway settlement execution path: deposit validation, credit accounting,
reserve and liability tracking, withdrawal orchestration, transaction construction, signing, submission and
confirmation, end to end and repeatably. **Production liquidity management, treasury operations and external
provider integrations will be completed during the pilot phase.**

Read the split this way: what is *proven* is the infrastructure and the settlement execution path on preprod;
what is *demonstrated* is that path re-running unattended against a live chain; what is *future pilot work* is
production USDM/USDCx liquidity, the treasury and vault model, liquidity provider selection and integration,
mainnet deployment, rebalancing automation beyond request-raising, and third-party security hardening.

## 8. What remains open

- The treasury entity and jurisdiction, which decides the Leg 3 sourcing route.
- Contracting and onboarding for Legs 1 and 3.
- Whether USDM or USDCx is designated primary at pilot start.
- The production vault and key policy, including whether the custodial hot wallet is replaced before mainnet.
- No third-party security audit of this codebase has been performed.
