# WFIT Stablecoin Gateway

External stablecoin value comes in, becomes an internal credit balance, and is settled back out as a real
transaction on Cardano. This repository is the working implementation, deployed and exercised on **Cardano
preprod**.

```
external stablecoin / exchange withdrawal
  → validated deposit             automatic — the gateway reads the source chain
  → WFIT credits                  off-chain accounting, issued from the observed amount
  → settlement liquidity process  operator-run, outside this system, recorded here
  → Cardano settlement reserve    WFIT-operated vault, balance read back off the chain
  → settlement asset              tADA on this preprod deployment; USDM / USDCx in production
  → user withdrawal               settled to a user-controlled Cardano address
```

The settlement liquidity step is deliberately not automated. No bridge, no DEX call, no market maker: an
operator converts external liquidity through an external route and books what happened, and the gateway
verifies the outcome against the vault's on-chain balance.

Some things this is deliberately not:

- **Not a new blockchain bridge.** Value crosses chains through existing external routes. This gateway
  validates what arrived and accounts for it.
- **Not a token.** WFIT credits are an off-chain accounting layer — not transferable between users, not a
  stablecoin, not a bridge asset.
- **Not a finished mainnet gateway.** This deployment validates the settlement engine and the accounting and
  failure controls around it. The production conversion route and USDM/USDCx settlement are pilot work.

Credits are issued only after a deposit has been validated on its source chain, from the amount that actually
arrived. Source-chain deposit custody and Cardano settlement liquidity are separate responsibilities with
separate addresses.

`CARDANO_NETWORK` refuses anything but `preprod`/`preview`, so no configuration mistake can point the signing
key at mainnet funds.

## Scope

This repository is a **standalone financial infrastructure layer** — deposit validation, credit accounting and
Cardano settlement. It carries no application logic of its own.

| | |
|---|---|
| **WChronicles** | the ecosystem/application — a separate, live product with its own users, database and wallets |
| **WFIT Stablecoin Gateway** | reusable financial infrastructure — this repository |

- It does **not replace WChronicles**, and it does not change how WChronicles works.
- It is **not integrated into WChronicles production**. No code, database, wallet, process, port or domain is
  shared, and nothing here reads or writes WChronicles data.
- It runs **separately, on Cardano preprod**, in its own folder with its own database, process and signing key.
- **WChronicles production remains untouched by this repository.**

The gateway is built to be reusable by any application that needs this layer, which is why the credit ledger
knows nothing about what credits are spent on.

## Current validation status

| | |
|---|---|
| Live gateway | <https://wfit-gateway.anchorflow.cloud> |
| Network | Cardano preprod |
| Settlement vault | `addr_test1vz3scr56jxyl7qez7c8m8z75r73vuhhs0kjl8tjp06yqvjga9h60a` |
| Cardano deposit address | `addr_test1vrldq43s4xqjnak2s04dg08v2w04cj62llxnqne683rsrpqjzdk6l` |
| Chain access | Blockfrost preprod (build + submit), Koios preprod (reads, confirmation fallback) |

**Exercised end to end on this deployment:**

| Step | Transaction |
|---|---|
| Vault funded from the testnet faucet | `2959dd4a47d4e31dfa3e09d08e96e947ee94937fce52816e9691f44692d2d743` |
| Deposit paid in by a test wallet | `8f2c33b8b720def1036b5c5e57ef2b8613b7ef984549e39ed0d1970b43bc7838` |
| Withdrawal settled by the gateway | `3918b29a73d00d34c09eb981d970173eb537f16babedeeb0931b025a88a31623` |

120 tADA arrived and 120 credits were issued. 50 credits were then redeemed: 0.25 flat + 0.50% = 0.5 credits
of fee, and 49.5 tADA settled on chain. Both explorers resolve the hashes —
[cardanoscan](https://preprod.cardanoscan.io/) and [cexplorer](https://preprod.cexplorer.io/).

**Re-run automatically, unattended, by `npm run demo:settlement`:**

| Step | Transaction |
|---|---|
| Deposit paid in by the demo wallet | `5f5f5084a119ba4f13a503493362401d14adc16733b2c5327e3e351e5faefdc5` |
| Withdrawal settled by the gateway | `dcbd5183d598be7615ced8800c548a39356da1fce17be38e04560eb9267be009` |

5 tADA in, 5 credits issued, 5 credits redeemed for 4.725 tADA after the 0.275 fee. The whole sequence —
deposit, validation, issuance, withdrawal, vault signature, submission, confirmation — took 165 seconds
unattended, and the settlement confirmed 21 seconds after the withdrawal was requested. The recorded run is in
[`docs/preprod-settlement-run.json`](docs/preprod-settlement-run.json). See
[Preprod automated settlement demonstration](#preprod-automated-settlement-demonstration).

**Preprod automated settlement demonstration using test liquidity (tUSDM):**

| Step | Transaction |
|---|---|
| Deposit paid in by the demo wallet | `2b1189ad9f8579b44769f5a0229d4a244f9ca133ae95c8b7dce97fae7351b2e5` |
| Withdrawal settled in tUSDM by the gateway | `8c2a2a5d8c3974176d36fff29386200ac10e168d2a53d0199cacf63b47cda11e` |

The same path, settling a **dollar-denominated native asset** instead of tADA: 5 credits redeemed for 4.725
tUSDM after the fee, confirmed on chain 73 seconds after the request, whole run 145 seconds unattended. The
destination output holds 4.725 tUSDM plus 1.05595 ADA of min-UTxO, and the vault went from 300 to 295.275
tUSDM. Recorded run: [`docs/preprod-settlement-run-tusdm.json`](docs/preprod-settlement-run-tusdm.json).

**tUSDM here is test liquidity, not production USDM.** It is a Cardano preprod test asset used to exercise the
settlement path for a dollar-denominated native asset. Production USDM/USDCx settlement depends on final
liquidity, treasury and provider setup during the pilot phase.

**Not exercised here:** USDM or USDCx payouts, an automated conversion route, and an exchange API. See
[Limitations](#limitations).

## What a reviewer can test

The deployment is open: register at <https://wfit-gateway.anchorflow.cloud>, no invitation needed. It is
Cardano preprod throughout, so nothing here involves real value.

1. **Get preprod tADA** from the [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet)
   into your own preprod wallet.
2. **Send some to the deposit address** `addr_test1vrldq43s4xqjnak2s04dg08v2w04cj62llxnqne683rsrpqjzdk6l`, then
   paste the transaction hash into **Fund credits**. Type a deliberately wrong amount while you are there — the
   gateway credits what it observed on chain, not what you typed.
3. **Watch the deposit move** `pending → confirming → credited`. Submit the same hash again: you get the
   original record back and a duplicate counter increments, not a second issuance.
4. **Request a withdrawal** to your own preprod address. The quote — credits used, fee, amount received — is
   computed server-side; a rate sent by the browser is ignored.
5. **Check the payout in an explorer.** Take the transaction hash to
   [cardanoscan](https://preprod.cardanoscan.io/) or [cexplorer](https://preprod.cexplorer.io/) and confirm it
   landed at your address, then confirm your balance dropped by exactly the credits used.
6. **Try the failure paths.** A hash that pays a different address, an amount below the route minimum, a
   withdrawal larger than your balance, a malformed destination — each is refused with a reason and without
   moving credits.
7. **Read the generated pages.** `/architecture` and `/evidence` render from this deployment's own
   configuration and records, not from hand-written copy.

**What you cannot test here, because it does not exist yet:** a USDM or USDCx payout, an automated conversion
route, or an exchange API. Those are pilot work.

## Catalyst pilot scope

**What this pilot demonstrates**

- **Deposit validation** — read from the source chain, credited from the amount that actually arrived.
- **Credit accounting** — append-only ledger, idempotency keys, and a conservation check that halts settlement
  on any drift.
- **Cardano settlement flow** — build, sign, submit, confirm, reconcile, from the gateway's own vault key.
- **Reserve protection** — per-asset thresholds, committed-versus-free liquidity, credit liability tracked
  against on-chain capacity, and settlements blocked before any credits are locked.
- **Automated settlement demonstration** — `npm run demo:settlement` re-runs the whole path unattended and
  verifies the resulting Cardano transaction independently of the gateway.
- **Rebalancing framework** — a low reserve raises a rebalance request automatically; the movement of
  liquidity itself remains a treasury action outside the system.
- **Failure handling** — rejected deposits, duplicate submissions, refunds before broadcast, and unproven
  submits held for review instead of guessed at.
- **Operational visibility** — `/architecture` and `/evidence` rendered from this deployment's own
  configuration and records.

**What this pilot does not demonstrate yet**

- **Production USDM settlement** — no USDM payout has been made by this deployment.
- **Production USDCx settlement** — no USDCx payout has been made by this deployment.
- **Automated liquidity conversion** — the gateway raises rebalance requests and records outcomes, but the
  conversion itself is an operator process it does not perform.
- **Provider integrations** — the Circle/USDC, USDM issuer and Cardano DEX routes are declared as typed
  interfaces marked `future_integration`. None is connected, and zero conversions have been executed.
- **Exchange integrations** — the exchange route is manual and admin-approved. No exchange API is integrated.

Those are pilot work. Nothing in this repository presents them as done.

The full Catalyst answer, including the candidate production settlement route and the gap responses, is in
[`docs/CATALYST.md`](docs/CATALYST.md).

## Architecture

Three parts, and they do not leak into each other:

- **`server/credits`** — balances and the ledger. The only place a balance changes. Every change writes one
  ledger row with a unique idempotency key, plus a conservation check comparing account totals against the
  ledger's issued-minus-consumed supply.
- **`server/deposits`** — one module per source chain answering "what actually arrived, and how deep is it
  buried". The service layer turns that into credits, once.
- **`server/settlement`** — Cardano transaction building, signing, submission and reserve balances.

`/architecture` on the live deployment renders the same model from the running configuration.

## Providers and responsibilities

"Provider" as one word hides too much, so each role is separate. The asset issuer is not the chain-data
provider, and neither of them holds the funds.

| Route | Asset issuer | Chain access | Validation | Custody | Automation |
|---|---|---|---|---|---|
| Ethereum Sepolia USDC | Circle (Sepolia test USDC) | public Sepolia JSON-RPC node | ERC-20 Transfer log from the receipt | WFIT-controlled Sepolia address | not exercised |
| Cardano preprod tADA | Cardano testnet faucet | Koios preprod | outputs paying the gateway deposit address | WFIT-controlled preprod address | **automatic** |
| Cardano preprod USDCx | not identified | Koios preprod | native-asset outputs to the deposit address | WFIT-controlled preprod address | not exercised |
| Centralised exchange | Circle / Tether, as held by the exchange | none — no exchange API | admin checks the withdrawal id against the exchange record | the exchange, then a WFIT treasury account | **manual** |

For Cardano settlement: submission is **Blockfrost preprod**, confirmation reads are **Koios preprod with
Blockfrost as a fallback**, and custody is the **WFIT-operated Cardano settlement vault**.

*automatic* — validated on chain and exercised end to end here. *manual* — an admin approves it. *not
exercised* — the validation code exists and is enabled, but no deposit has been credited through it here.

## Deposit routes in, Cardano settlement out

Deposits and withdrawals are not symmetrical, and the asymmetry is deliberate.

- **Deposit routes (inbound only)** — Cardano preprod, Ethereum Sepolia, and exchange withdrawals booked in by
  an admin. Every route in the table above is a way for value to *arrive*.
- **Settlement destinations (outbound)** — **Cardano only**. The production settlement assets are **USDM and
  USDCx on Cardano**; this preprod deployment settles tADA.

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

## Custody

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

**Status: custodial.** Between the deposit landing and the settlement transaction confirming, WFIT holds the
funds. We state that plainly; the gateway is not, and is not described as, non-custodial.

| Stage | Controlled by | Model |
|---|---|---|
| User wallet, before deposit | the user | user-controlled |
| Deposit address, one per source chain | WFIT | custodial |
| Credits ledger | the gateway database, append-only | accounting only — holds no funds |
| Treasury / rebalancing layer | the WFIT treasury operator, outside this system | custodial |
| Cardano settlement vault | WFIT, single signing key | custodial hot wallet |
| User Cardano wallet, after settlement | the user | user-controlled |

- **Preprod vault address:** `addr_test1vz3scr56jxyl7qez7c8m8z75r73vuhhs0kjl8tjp06yqvjga9h60a` — public and
  checkable, holding no mainnet value.
- **Production vaults and their key policy are to be declared before mainnet pilot deployment.** Nothing here
  commits to the production custody arrangement.

Detail on each hop:

- **Source-chain deposits** sit at WFIT-controlled deposit addresses, one per chain. Custodial. The exchange
  route has no gateway-controlled address at all: funds land in a WFIT treasury account at the exchange.
- **Credits** are database accounting only.
- **The Cardano settlement reserve** is a dedicated WFIT-operated vault at the address above — public and
  checkable. It is a custodial hot wallet: no smart-contract vault, no multi-signature scheme. We do not
  describe it as non-custodial. The production vault and its key policy are to be declared before mainnet.

The signing key lives outside the repository, mode 600, read once by the server process. It is never logged,
never returned by an API and never reaches the browser. The server refuses to read it if the file is group- or
world-readable.

## Deposits

The declared amount is never trusted. For Cardano the gateway sums the transaction's outputs to the deposit
address for the expected asset; for Sepolia it reads the ERC-20 Transfer log from the receipt. Credits are
issued from the observed amount once the confirmation target is met.

Submitting the same transaction hash again returns the original deposit and increments a duplicate counter —
a unique index on `(network, txHash)` is what enforces it, not application logic.

## Credits

- One credit is one US dollar of validated deposit value, before fees.
- Internally everything is integer base units: `1 credit = 1,000,000 units`. Parsing and formatting live in
  `server/money.ts`; no other module divides or multiplies a balance by a float.
- An account has `available` and `locked`. A withdrawal locks; only a confirmed settlement consumes.
- Every movement writes a ledger row: direction, amount, kind, reference, idempotency key. Balances are never
  written directly.
- `checkIntegrity()` compares total balances against ledger supply, credited deposits against credits issued,
  and confirmed withdrawals against credits consumed. Any drift halts settlement.

## Settlement

`server/settlement/cardano.ts` builds, signs and submits real transactions from the gateway's own vault key
using [lucid-evolution](https://github.com/Anastasia-Labs/lucid-evolution).

Three separate things get confused if they share one column, so they are kept apart. **Registered** means the
settlement-asset registry knows the asset. **Enabled** means this deployment will select it for a payout.
**Exercised** means a transaction exists. Only tADA is all three.

| Asset | Registered | Enabled here | Exercised here |
|---|---|---|---|
| Preprod ADA (tADA) | yes | yes | **yes** — settled on chain by this deployment |
| tUSDM preprod test asset, policy `11c93226…0214` | yes | behind `SETTLEMENT_TUSDM_ENABLED` | see below |
| USDCx preprod registry asset, policy `31dde3db…bf66` | yes | no — disabled by default (`SETTLEMENT_USDCX_ENABLED`) | no |
| USDM, Cardano mainnet | production target | no | no |
| USDCx, Cardano mainnet | production target | no | no |

- **tADA** is the preprod network's own asset, from the official testnet faucet. Not a stablecoin: it proves
  the settlement path, not the peg.
- **tUSDM** is a Cardano preprod **test asset** held by the settlement vault as test liquidity. Its on-chain
  CIP-68 metadata declares 6 decimals, the ticker tUSDM and the URL mehen.io — but that metadata is asserted by
  whoever minted the policy, the subject is **not** in the Cardano Foundation preprod token metadata registry,
  and we have not identified issuer documentation confirming this policy id. It is used strictly to exercise
  the settlement path for a dollar-denominated native asset. **It is not production USDM**, and no issuer
  relationship exists. Production USDM/USDCx settlement depends on final liquidity, treasury and provider setup
  during the pilot phase.
- The **preprod asset named USDCx** is registered in the Cardano Foundation preprod token metadata registry
  with 6 decimals. We have not identified issuer documentation confirming it as official Circle USDCx, so it
  is treated as a test asset and is disabled by default.
- **USDM** — Moneta publishes a mainnet policy id. We have not identified an issuer-confirmed USDM deployment
  on Cardano preprod.
- **USDCx on mainnet** — published mainnet policy id.

USDM and USDCx are production settlement targets **at the same level of support**. They differ only in how the
reserve would be sourced, not in how the gateway settles them: the registry treats them identically, and
neither has been exercised. Nothing in this repository ranks one above the other.

What the preprod tADA settlement proves: coin selection, transaction construction, signing, submission,
confirmation, the withdrawal state transition, and the credits reconciliation that follows. What it does not
prove: that USDM or USDCx payouts have been validated. None have been made by this deployment.

"USDCx" refers to four different things across this repository. They are not interchangeable:

| Reference | State here |
|---|---|
| USDCx preprod **deposit route** | implemented and **enabled**, but **not exercised** — no deposit has been credited through it |
| USDCx preprod **settlement asset** | **registered, disabled by default** (`SETTLEMENT_USDCX_ENABLED`); a preprod registry entry, not issuer-confirmed |
| USDCx on **Cardano mainnet** | a **registered production target** — not enabled, not exercised here |
| USDCx reached via **Circle xReserve** | a **candidate production reserve-funding route** identified by research — not integrated, not exercised, no relationship with the provider |

## Reserve, liability and coverage

Two numbers decide whether the gateway can honour what it owes, and they are measured from different places
on purpose:

- **Capacity** is read from the chain — the vault's balance for a settlement asset, minus what is already
  committed to withdrawals that have not yet landed. That difference is what a new withdrawal can draw on.
- **Liability** is read from the credit ledger — every credit issued and not yet settled, whether it is
  available in an account or locked behind a withdrawal in flight.

`GET /api/reserve` reports both, plus the surplus and a coverage percentage, and raises warnings when a
reserve drops below its minimum or critical threshold, when outstanding credits exceed capacity, or when
capacity has fallen below the largest single withdrawal the gateway advertises. Capacity is expressed in
credit-equivalent units at this deployment's settlement rate so the two figures are directly comparable.

Because the two are measured independently, **no operator entry can make the gateway look solvent**. Marking
a rebalance completed grants no capacity: capacity is re-read from the vault's on-chain balance, so a
top-up that was booked but never arrived leaves the reserve exactly as short as it was. There is a test for
precisely that.

On this preprod deployment the reserve is funded from the testnet faucet, so coverage figures evidence the
mechanism, not a treasury policy. Sizing thresholds against real liabilities is pilot work.

## Liquidity and rebalancing

**The gateway does not execute conversions.** No bridge, no DEX integration, no market maker. Conversion of
external stablecoin liquidity into Cardano settlement liquidity happens outside the system. The gateway
defines the interface, records what happened, and verifies the result against the chain.

**Today:** reserve tracking read from the chain, credit-liability and coverage tracking, threshold-triggered
rebalance requests, rebalance records, and manual treasury operations.
**Pilot work:** selecting and contracting the treasury route, completing any issuer onboarding, and automating
what can be automated — reserve-triggered rebalance records, on-chain verification of the resulting mint
transaction, swap quote and slippage pre-checks with policy-bounded signing, and reverse-leg monitoring. No
provider is selected. Candidate routes are listed below precisely so that "unidentified" is not the answer,
and identification is stated separately from integration.

- **Trigger** — the free reserve for a settlement asset falls below its minimum, or a planned withdrawal would
  take it there.
- **Operator action** — the treasury converts external liquidity into the Cardano settlement asset using the
  declared external route, then sends it to the settlement vault.
- **Production conversion provider** — *to be selected and declared before mainnet pilot deployment.*
- **Recorded per rebalance** — source network, source asset and amount, provider, destination settlement
  asset, expected amount, actual amount, external reference, status and timestamps.
- **Status** — `planned` → `processing` → `completed` / `failed`.
- **Completion rule** — settlement capacity comes from the vault's on-chain balance, read independently of any
  rebalance record. Marking a rebalance completed does not by itself allow a payout.

**Operational rules — today versus pilot.** Stated as a split so nothing on the right-hand column is read as
already running.

| | Today, on this deployment | Pilot |
|---|---|---|
| Reserve monitoring | on-chain balance read per settlement asset, free = balance − committed | unchanged, plus alerting |
| Thresholds | configured per asset in base units: critical / minimum / target | unchanged, sized against observed pool depth |
| Rebalance trigger | a rebalance **request** is raised automatically when the free reserve falls below its minimum; a person still decides what to do about it | unchanged, plus alerting and provider routing |
| Conversion itself | **a manual treasury action, entirely outside this system** | provider-integrated, with quote and slippage pre-checks and policy-bounded signing |
| Recording | an admin books the rebalance and what actually arrived | written automatically from the provider response |
| Verification | the vault's on-chain balance, read independently of the record | plus on-chain verification of the mint transaction, and reverse-leg monitoring |

**What the automation does and does not do.** A background job raises a rebalance *request* when the free
reserve for an asset falls below its minimum: a `planned` record with no provider and no source assigned,
because the gateway knows the reserve is short but not where liquidity should come from. While a request for
an asset is still open no second one is raised, so a job running every few seconds cannot bury the operator in
duplicates of one alert. **No automated job moves liquidity, executes a conversion, contacts a provider, or
completes a rebalance** — a request is a signal for a human, and everything after it is a treasury action
outside this system. The background jobs otherwise chase deposits toward their confirmation target, settle
withdrawals parked for liquidity, confirm broadcast settlements and snapshot the reserve. Percentages, provider names and pool sizes are deliberately not quoted here:
none has been selected, and any figure would date.

### Liquidity provider routes — declared in code, not integrated

`server/providers/registry.ts` declares the routes a pilot integration would use — a Circle/USDC route, a USDM
issuer route, and a Cardano DEX route — each carrying `status: "future_integration"` and the list of things
that would have to be true before it could be enabled. It also declares the `LiquidityProvider` interface such
an integration would have to implement.

**Nothing in that file is connected.** There is no implementation of the interface in this repository, no
credential, and no API call. `PROVIDER_INTEGRATION_STATUS` records zero integrated providers and zero executed
conversions, and the function that would run a route throws `provider_not_integrated` by design — so a future
change that starts treating a declared route as an executable one fails loudly instead of quietly implying a
conversion happened. The registry exists so the shape of a pilot integration is visible and typed, and so a
reviewer can confirm it is empty rather than take our word for it.

### Production settlement route — candidate, not integrated

Reaching Cardano settlement liquidity is a three-leg process, and no single provider performs all of it.
**None of the routes below is integrated. No account, agreement, onboarding or API access exists with any
party named, and none has been contacted — these are candidate routes identified by desk research.**

1. **Normalisation — treasury, manual.** External stablecoin liquidity (USDC, USDT, or USDC on another chain)
   is converted to USDC on a chain the Cardano entry route accepts. Performed by an operator through an
   exchange or an issuer fiat account; no exchange API is integrated and none is claimed.
2. **Cardano entry — third-party issuer infrastructure.** USDC is deposited into Circle's xReserve contract
   and USDCx is minted to a WFIT-controlled Cardano address. Attestation is performed by Circle and by the
   Cardano-side network operator. **WFIT would be a user of this publicly available route, not an operator of
   it, and holds no partner or API access to it.** The operator documents a reverse path from Cardano back to
   USDC; we have not exercised it.
3. **Settlement asset.** Where USDM is required, it is sourced either by an on-chain swap from USDCx on a
   Cardano DEX, or by direct issuance from the USDM issuer — Moneta, which states that it mints and redeems in
   licensed US states, or NBX, which states that it is the EEA co-issuer under MiCA. Which applies depends on
   the treasury entity's jurisdiction and banking access. That is an open pilot decision.

Regulatory descriptions above are the providers' own statements about themselves. We report them; we do not
certify them.

Of these, the Cardano entry route has the fewest onboarding preconditions: wallets, rather than a banking
relationship or issuer onboarding. That is an observation about preconditions, not a selection, and it does
not make either settlement asset primary.

**Sizing constraint.** Cardano stablecoin liquidity is finite, and stable-pair pool depth is a small fraction
of network supply. Settlement sizing and reserve thresholds are set against depth observed at the time of
operation, not against theoretical capacity. Figures are deliberately not quoted here, because they date.

Reserve thresholds are configured per settlement asset, in that asset's base units:

| Condition | Meaning |
|---|---|
| free ≥ target | healthy |
| minimum ≤ free < target | healthy-low, monitor |
| critical ≤ free < minimum | low, rebalance required |
| free < critical | critical |
| free < the requested settlement | that settlement is blocked before any credits are locked |

"Free" is the on-chain balance minus everything already committed to withdrawals that have not yet settled.

## How a deposit becomes a settled payout

Worked through with numbers, because the abstract description invites the wrong reading — that each deposit is
converted individually and immediately. It is not.

**100 USDC deposited, 50 credits later redeemed:**

1. A user sends 100 USDC on a supported deposit route and submits the transaction hash.
2. The gateway reads the source chain and validates what actually arrived — 100 USDC, not a declared amount.
3. **100 credits are issued** to the account, minus any configured deposit fee (currently none). The deposited
   USDC stays where it landed. **Nothing is converted at this moment.**
4. The treasury monitors the Cardano settlement reserve against its per-asset thresholds. Conversion of
   external liquidity into the Cardano settlement asset happens **when a threshold is crossed** — in batches,
   on the treasury's schedule, **not once per deposit**.
5. The user later requests a withdrawal of 50 credits. The fee is 0.25 flat + 0.50% = 0.5 credits, leaving 49.5.
6. The gateway checks the free reserve can cover 49.5, locks 50 credits, then builds, signs and submits a
   Cardano transaction paying 49.5 of the settlement asset to the user's Cardano address.
7. Once the transaction confirms on chain, the locked credits are consumed. In production the payout asset is
   **USDM or USDCx** from the settlement reserve; on this preprod deployment it is tADA.

**What this does not mean.** No deposit is converted one-for-one at deposit time, and no conversion is
triggered by an individual deposit. Credits are an accounting claim issued on validation; the reserve that
settles them is managed separately against thresholds. Conflating the two would describe a bridge, which this
is not.

The same example ran for real on this deployment with tADA in place of USDC: 120 in, 120 credits, 50 redeemed,
49.5 settled. The hashes are in [Current validation status](#current-validation-status).

## Preprod automated settlement demonstration

`npm run demo:settlement` runs the whole path unattended and proves it with two on-chain transactions:

```bash
DEMO_PASSWORD=<pick-one> npm run demo:settlement -- --amount 5 --out run.json
DEMO_PASSWORD=<pick-one> npm run demo:settlement -- --amount 5 --asset tusdm-preprod   # test liquidity
```

It drives this deployment's own HTTP API — the same endpoints the browser uses — and does the following:

1. loads the demo wallet's preprod signing key from disk (never from the repository);
2. sends real tADA to the gateway's deposit address and waits for the gateway to validate it on chain;
3. registers or signs in, and confirms the credits were issued for the amount that actually arrived;
4. requests a withdrawal back to the demo wallet, which locks the credits;
5. waits while the settlement queue builds, signs and submits the payout from the vault;
6. waits for confirmation, at which point the locked credits are consumed;
7. **re-checks the settlement transaction against Koios directly**, so the gateway is not the only witness to
   its own success;
8. writes an evidence record with both transaction hashes, explorer links, timings, and the reserve before
   and after.

It asserts rather than announces: a deposit that is rejected, a settlement that fails or is refunded, or a
transaction Koios cannot see all exit non-zero. It cannot report a success it did not achieve.

`--asset tusdm-preprod` runs the same demonstration settling **test liquidity** in a dollar-denominated native
asset instead of tADA, which additionally exercises native-asset coin selection and the min-UTxO ADA that
leaves the vault alongside the token.

**What it demonstrates:** the settlement execution path, on Cardano preprod, end to end.
**What it does not demonstrate:** production liquidity, treasury operations, production USDM or USDCx
settlement, or any external provider. The settlement assets are tADA and a preprod tUSDM **test** asset, which
evidence the mechanism and not a peg or an issuer relationship. Production USDM/USDCx settlement depends on
final liquidity, treasury and provider setup during the pilot phase.

## Fees

| Fee | Charged by | Current setting |
|---|---|---|
| Source-chain / exchange network fee | the source chain or exchange | outside the gateway — only what actually arrives is credited |
| Deposit fee | WFIT gateway | none |
| Credits conversion basis | — | 1 credit = 1 USD of validated deposit value, before fees |
| Withdrawal fee | WFIT gateway | 0.25 credits flat + 0.50% |
| Cardano network fee | the Cardano network | paid by the settlement vault, not deducted from the user's amount |

These are **preprod demonstration configuration**, not a committed production price. Every rate and fee is
computed server-side; a rate sent by a browser is ignored, and there is a test for exactly that. Before
confirming, the user is shown the credits used, the rate, the gateway fee and the amount they will receive.

## Failure and refund logic

### Lifecycle states

The happy path, end to end:

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
| `confirming` | found and paying the deposit address; waiting for the route's confirmation target | `confirmed` · `rejected` |
| `confirmed` | validated at or above the target, from the amount observed on chain | `credited` |
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

### What "refund" means

- **Credits.** A refund releases locked credits back to the account's available balance. It happens only where
  the settlement transaction was provably never broadcast, and it is idempotent — a second refund call is a
  no-op.
- **Deposits.** **The gateway does not refund deposits, and no code path exists to do so.** A rejected deposit
  issues zero credits and the funds remain at the deposit address under operator control. Returning them to
  the sender is an off-system treasury action, not a gateway function.
- **Unproven settlements.** Never auto-refunded. The credits stay locked and the withdrawal is held in
  `manual_review`, because refunding a transaction that later confirms would pay twice.

### Failure cases

| Case | Where it is caught | Result |
|---|---|---|
| Unsupported or unrecognised asset | deposit validation | rejected, 0 credits |
| Missing confirmations | deposit validation | held at `confirming`, 0 credits until the target is met |
| Duplicate deposit | unique index on `(network, txHash)` | original record returned, issued once |
| Insufficient liquidity | reserve check at request time | refused before any credits are locked |
| Failed Cardano transaction | build / sign / first submit | `failed`, nothing broadcast, credits released |
| Unprovable Cardano submit | post-submit | `manual_review`, credits stay locked |

**Deposits**

| Situation | Result | Credits |
|---|---|---|
| Unsupported or unrecognised | rejected | 0 |
| Not on chain yet | pending | 0 |
| Below the confirmation target | confirming | 0 |
| Pays a different address | rejected with the reason | 0 |
| Same transaction again | original record returned, counter increments | issued once |
| Below the route minimum | rejected | 0 |
| Exchange deposit rejected by an admin | rejected, cannot then be approved | 0 |
| Confirmed | credited from the observed amount | issued once |

**Withdrawals**

| Situation | Result | Credits |
|---|---|---|
| Invalid or wrong-network destination | refused before anything locks | untouched |
| More credits than the account holds | refused before anything locks | untouched |
| Reserve cannot cover it | refused at request time; parked as pending if the reserve drops after the check | untouched, or locked and safe |
| Build / balance / coin selection / signing fails | failed — nothing broadcast | released |
| Node rejects the **first** submit | failed — provably never broadcast | released |
| Submit outcome cannot be proven | `manual_review` with the hash | stay locked, never auto-refunded |
| Confirmed on chain | confirmed, hash stored | locked credits consumed |
| Refund attempted twice | second call is a no-op | released once |

The rule that prevents double payment: everything that can fail happens *before* broadcast, so those cases
release credits safely. Once a submit has been attempted and the outcome cannot be proven, the credits stay
locked — the transaction may still confirm. A rejection on a *resubmit* proves nothing, because if our
transaction was applied its inputs are already spent and the node rejects the duplicate.

## TRL evidence

The Stablecoin Gateway integration is at **TRL 5**: its core integrated components have been validated in a
relevant environment — real on-chain deposit verification, idempotent credits issuance, accounting integrity
controls, reserve checks, withdrawal orchestration, failure handling and real Cardano preprod settlement,
exercised end to end.

The pilot extends this into production USDM/USDCx settlement liquidity, declared production conversion and
interoperability routes, and the broader WFIT ecosystem.

`/evidence` on the live deployment is generated from this deployment's own records: the environment, credited
deposits with their source transaction, duplicate submissions prevented, rejected deposits with reasons and
zero credits, settled withdrawals with the Cardano transaction hash, reserve thresholds and health, credit
liability against settlement capacity, the credit conservation check, the declared-but-unintegrated liquidity
routes, and the failure rules the code enforces.

The settlement path is also **reproducible on demand** rather than only historical: `npm run demo:settlement`
re-runs deposit → validation → credits → withdrawal → settlement → confirmation unattended, and re-checks the
resulting transaction against Koios independently. A recorded run is in
[`docs/preprod-settlement-run.json`](docs/preprod-settlement-run.json).

## Preprod deployment

```bash
npm run build
pm2 start ecosystem.config.cjs
npm run reserve:check      # confirms the key, the address and the on-chain balance
curl -s localhost:4523/api/health
```

nginx proxies the chosen domain to `PORT`. Nothing else on the host is touched: its own folder, database,
port, pm2 process and wallet.

## Limitations

- The settlement reserve is a **custodial hot wallet**. No smart-contract vault, no multi-signature.
- The **production conversion and rebalancing provider must be explicitly declared and integrated** before a
  mainnet pilot. This implementation raises the request and records the operation; it does not perform it, and
  no provider in `server/providers/registry.ts` is connected.
- **Reserve coverage figures on this deployment are faucet-funded** and evidence the mechanism, not a treasury
  policy. Threshold sizing against real liabilities is pilot work.
- The **CEX route is manual**. No exchange API is integrated, and none is claimed.
- **tADA demonstrates settlement mechanics, not stablecoin peg behaviour.**
- The preprod asset named USDCx is **not presented as issuer-confirmed**, and is disabled by default.
- We make **no claim about official preprod USDM or USDCx availability** without issuer confirmation. Where
  something is unknown, the code and the pages say it is unknown rather than asserting a negative.
- The Sepolia USDC and preprod USDCx deposit routes are implemented and enabled but **have not been exercised
  end to end** on this deployment.

## Local setup

```bash
npm install
docker run -d --name wfit-gateway-mongo -p 127.0.0.1:27019:27017 mongo:7
cp .env.example .env      # fill in SESSION_SECRET and ADMIN_PASSWORD
npm run wallet:create     # writes the signing key, prints the address to fund
# put the printed address in SETTLEMENT_VAULT_ADDRESS
npm run dev               # API on :4523
npm run test
```

Fund the printed address from the [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet).
See `.env.example` for every variable; only `SESSION_SECRET` and `ADMIN_PASSWORD` have no default, and the
process refuses to start without them.

### The preprod settlement wallet

The settlement wallet is a **dedicated Cardano preprod test wallet**, created by `npm run wallet:create` for
this gateway alone. It is not shared with any production system, any other application, or any other wallet on
the host, and it can never be pointed at mainnet: `server/config.ts` refuses to start on any network other than
preprod or preview, so a misconfiguration cannot aim the signer at real funds.

| | |
|---|---|
| Network | Cardano **preprod** (testnet) |
| Address | `addr_test1vz3scr56jxyl7qez7c8m8z75r73vuhhs0kjl8tjp06yqvjga9h60a` |
| Purpose | settlement payouts for this gateway only |
| Key location | outside the repository, `SETTLEMENT_KEY_PATH`, mode `600` |

**How signing access is provided.** The bech32 `ed25519_sk` lives in a file on the deployment host, outside the
repository and outside the database, referenced only by path. `server/settlement/cardano.ts` reads it on first
use, **refuses to load it if the file is group- or world-readable**, and never logs, returns or transmits it.
No seed phrase, private key or mnemonic appears anywhere in this repository, in `.env.example`, or in any API
response — the gateway publishes only the public address. That is the whole of the signing model: a hot key on
a host, appropriate for a preprod demonstration and explicitly named as a limitation for production, where the
custodial hot wallet is expected to be replaced.

**Funding it manually.** Send test liquidity straight to the address above:

- **tADA** — from the [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet), for
  both payouts and transaction fees. Native-asset payouts also carry min-UTxO ADA, so the vault needs tADA
  regardless of which asset it settles.
- **A preprod native test asset** (for example the registry-listed preprod USDCx) — send it to the same
  address and enable it for settlement with `SETTLEMENT_USDCX_ENABLED=true`. The vault reads whatever it holds;
  nothing needs to be registered by hand.

Then confirm what actually arrived:

```bash
npm run reserve:check      # address, per-asset on-chain balances, and a warning if the key and the configured address disagree
curl -s localhost:4523/api/reserve
```

Both read the balance from the chain, not from any record inside the gateway. The vault address, its incoming
funding, its outgoing settlements and every transaction hash are also shown on `/evidence` with explorer links,
so the wallet can be audited without access to this deployment.

### Rotating the settlement key

1. `mv /root/.wfit-gateway/settlement.preprod.key{,.old}`
2. `npm run wallet:create` — writes a new key and prints the new address
3. update `SETTLEMENT_VAULT_ADDRESS`, restart, then move the remaining funds from the old address
4. destroy the old key file once the balance is zero

## License

MIT — see [LICENSE](LICENSE).
