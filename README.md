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

**Not exercised here:** USDM or USDCx payouts, an automated conversion route, and an exchange API. See
[Limitations](#limitations).

## Catalyst pilot scope

**What this pilot demonstrates**

- **Deposit validation** — read from the source chain, credited from the amount that actually arrived.
- **Credit accounting** — append-only ledger, idempotency keys, and a conservation check that halts settlement
  on any drift.
- **Cardano settlement flow** — build, sign, submit, confirm, reconcile, from the gateway's own vault key.
- **Reserve protection** — per-asset thresholds, committed-versus-free liquidity, and settlements blocked
  before any credits are locked.
- **Failure handling** — rejected deposits, duplicate submissions, refunds before broadcast, and unproven
  submits held for review instead of guessed at.
- **Operational visibility** — `/architecture` and `/evidence` rendered from this deployment's own
  configuration and records.

**What this pilot does not demonstrate yet**

- **Production USDM settlement** — no USDM payout has been made by this deployment.
- **Production USDCx settlement** — no USDCx payout has been made by this deployment.
- **Automated liquidity conversion** — conversion and rebalancing are operator processes that this gateway
  records, not performs.
- **Exchange integrations** — the exchange route is manual and admin-approved. No exchange API is integrated.

Those four are pilot work. Nothing in this repository presents them as done.

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

## Custody

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

| Asset | Network | Status |
|---|---|---|
| Preprod ADA (tADA) | preprod | the network's own asset, from the testnet faucet. **Exercised.** Not a stablecoin — it proves the settlement path, not the peg. |
| USDCx (preprod), policy `31dde3db…bf66` | preprod | **test asset, disabled by default.** Registered in the Cardano Foundation preprod token metadata registry with 6 decimals. We have not identified issuer documentation confirming it as official Circle USDCx. |
| USDM | mainnet | **production target.** Moneta publishes a mainnet policy id. We have not identified an issuer-confirmed USDM deployment on Cardano preprod. |
| USDCx | mainnet | **production target.** Published mainnet policy id. |

What the preprod tADA settlement proves: coin selection, transaction construction, signing, submission,
confirmation, the withdrawal state transition, and the credits reconciliation that follows. What it does not
prove: that USDM or USDCx payouts have been validated. None have been made by this deployment.

"USDCx" appears in three different places in this repository, with three different states. They are not
interchangeable:

| Reference | State here |
|---|---|
| USDCx preprod **deposit route** | implemented and **enabled**, but **not exercised** — no deposit has been credited through it on this deployment |
| USDCx preprod **settlement asset** | **disabled by default** (`SETTLEMENT_USDCX_ENABLED`); a preprod registry entry, not issuer-confirmed |
| USDCx on **Cardano mainnet** | **informational only** — a production settlement target, neither deployed nor exercised here |

## Liquidity and rebalancing

**The gateway does not execute conversions.** No bridge, no DEX integration, no market maker. Conversion of
external stablecoin liquidity into Cardano settlement liquidity happens outside the system. The gateway
defines the interface, records what happened, and verifies the result against the chain.

**Today:** reserve tracking read from the chain, rebalance records, and manual treasury operations.
**Pilot work:** selecting, declaring and integrating the production liquidity and conversion route. No
provider is named here, because none has been integrated.

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

Reserve thresholds are configured per settlement asset, in that asset's base units:

| Condition | Meaning |
|---|---|
| free ≥ target | healthy |
| minimum ≤ free < target | healthy-low, monitor |
| critical ≤ free < minimum | low, rebalance required |
| free < critical | critical |
| free < the requested settlement | that settlement is blocked before any credits are locked |

"Free" is the on-chain balance minus everything already committed to withdrawals that have not yet settled.

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
zero credits, settled withdrawals with the Cardano transaction hash, reserve thresholds and health, the credit
conservation check, and the failure rules the code enforces.

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
  mainnet pilot. This implementation records the operation; it does not perform it.
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

### Rotating the settlement key

1. `mv /root/.wfit-gateway/settlement.preprod.key{,.old}`
2. `npm run wallet:create` — writes a new key and prints the new address
3. update `SETTLEMENT_VAULT_ADDRESS`, restart, then move the remaining funds from the old address
4. destroy the old key file once the balance is zero

## License

MIT — see [LICENSE](LICENSE).
