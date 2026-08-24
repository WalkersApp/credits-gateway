# WFIT Stablecoin Gateway (Cardano preprod)

A working reference implementation of the WFIT stablecoin gateway: external stablecoin value comes in,
becomes an internal credit balance, and is settled back out as a real transaction on **Cardano preprod**.

It is deliberately a preprod system. `CARDANO_NETWORK` refuses anything but `preprod`/`preview`, so no
configuration mistake can point the signing key at mainnet funds.

## Architecture

```
external stablecoin / exchange withdrawal
        ↓  deposit validation (read the source chain, never the user's word)
WFIT credits  (internal ledger, integer units, 1 credit = 1 USD before fees)
        ↓  withdrawal: lock credits → build, sign, submit
Cardano preprod settlement reserve (custodial hot wallet)
        ↓
user-controlled Cardano address
```

Three parts, and they do not leak into each other:

- **`server/credits`** — balances and the ledger. The only place a balance changes. Every change writes one
  ledger row with a unique idempotency key, plus a conservation check that compares account totals against
  the ledger's issued-minus-consumed supply.
- **`server/deposits`** — one module per source chain that answers "what actually arrived, and how deep is
  it buried". The service layer turns that into credits, once.
- **`server/settlement`** — Cardano transaction building, signing and submission, plus reserve balances.

## Supported routes

| Network | Asset | Verification | Notes |
| --- | --- | --- | --- |
| Ethereum Sepolia | USDC (`0x1c7D…7238`) | automatic, on chain | Circle's testnet USDC, read from the transfer log over a public JSON-RPC node |
| Cardano preprod | tADA | automatic, on chain | read via Koios |
| Cardano preprod | USDCx (preprod) | automatic, on chain | preprod native asset, see *Settlement assets* |
| Centralised exchange | USDC / USDT | **manual** | the user submits the exchange withdrawal id; an admin verifies and approves |

No exchange API is integrated, and the gateway does not claim one. The CEX route is manual everywhere it
appears: in the UI, in the architecture page, and in the route configuration.

## Credits model

- One credit is one US dollar of validated deposit value, before fees.
- Internally everything is integer base units: `1 credit = 1,000,000 units`. Parsing and formatting live in
  `server/money.ts`; no other module divides or multiplies a balance by a float.
- An account has `available` and `locked`. A withdrawal locks; only an on-chain settlement consumes.
- Every movement writes a ledger row: direction, amount, kind, reference and idempotency key. Balances are
  never written directly.
- `checkIntegrity()` compares the sum of all balances with the ledger supply, credited deposits with the
  credits issued for deposits, and confirmed withdrawals with the credits consumed. Any drift halts
  settlement.

## Cardano settlement

`server/settlement/cardano.ts` builds, signs and submits real transactions from the gateway's own vault key
using [lucid-evolution](https://github.com/Anastasia-Labs/lucid-evolution) and Koios. It exposes
`validateAddress`, `getReserveBalance`, `estimateSettlement`, `submitSettlement` and `getTransactionStatus`.

The contract the withdrawal flow relies on:

- everything thrown from `submitSettlement` happened **before** broadcast, so the caller may release credits;
- when that cannot be proven, it returns `ambiguous: true` with the hash and the withdrawal goes to
  `manual_review` with the credits still locked.

A first-attempt node rejection is proof the transaction never landed. A rejection on a *resubmit* is not —
once our transaction is applied its inputs are spent and the node rejects the duplicate — so only the first
attempt may conclude "rejected", and only a chain lookup may conclude "paid".

### Settlement assets

| Asset | Network | Status |
| --- | --- | --- |
| Preprod ADA (tADA) | preprod | **official network asset**, from the testnet faucet. Not a stablecoin — it proves the settlement path, not the peg. |
| USDCx (preprod), policy `31dde3db…bf66` | preprod | **test asset.** Registered in the Cardano Foundation preprod token metadata registry with 6 decimals, but no Circle or IOG source publishes this policy id for preprod. |

There is no official **USDM** on preprod: Moneta publishes a mainnet policy only
(`c48cbb3d…47ad`, asset name `0014df105553444d`). **USDCx** on mainnet is `1f3aec8b…7e34`. The UI labels
official and test assets differently everywhere they appear, and the architecture page states this in words.

## Failure handling

| Situation | Behaviour |
| --- | --- |
| Unsupported / unrecognised deposit | rejected, no credits |
| Deposit not yet confirmed | pending or confirming, no credits |
| Same transaction submitted again | unique index on `(network, txHash)` returns the original deposit |
| Amount below the route minimum | rejected with a reason |
| Exchange deposit rejected by an admin | rejected, and it can never then be approved |
| Withdrawal fails before broadcast | locked credits released |
| Reserve cannot cover the settlement | no transaction attempted; credits untouched |
| Broadcast outcome unknown | `manual_review`, credits stay locked, never auto-refunded |
| Settlement confirmed | locked credits consumed, tx hash stored |
| Repeated API calls | unique idempotency keys — no double credit, double payment or double refund |

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

## Preprod deployment

```bash
npm run build
pm2 start ecosystem.config.cjs
npm run reserve:check      # confirms the key, the address and the on-chain balance
curl -s localhost:4523/api/health
```

nginx proxies the chosen domain to `PORT`. Nothing else on the host is touched: its own folder, database,
port, pm2 process and wallet.

## Environment variables

See `.env.example`. Every variable is listed there with a comment; only `SESSION_SECRET` and
`ADMIN_PASSWORD` have no default, and the process refuses to start without them.

## Security

- The Cardano signing key lives outside the repository, mode 600, read once by the server process. It is
  never logged, never returned by an API, and never reaches the browser. The server refuses to read it if
  the file is group- or world-readable.
- Amounts, rates, fees and destination addresses are all validated and computed server-side. A rate sent by
  a client is ignored — there is a test for exactly that.
- Value-moving endpoints are rate limited and require a session; admin endpoints require the admin password.
- Uniqueness in the database is the real idempotency mechanism: one credit per transaction, one per exchange
  reference, one ledger row per key.

### Rotating the settlement key

1. `mv /root/.wfit-gateway/settlement.preprod.key{,.old}`
2. `npm run wallet:create` — writes a new key and prints the new address
3. update `SETTLEMENT_VAULT_ADDRESS`, restart, then move the remaining funds from the old address
4. destroy the old key file once the balance is zero

## Running a test end to end

1. Open the gateway URL and create an account (any email — this is a preprod system with test funds).
2. **Fund credits.** Pick a route:
   - *Ethereum Sepolia USDC* — get test USDC from Circle's faucet, send it to the deposit address shown,
     paste the transaction hash. The gateway reads the transfer log and credits what actually arrived.
   - *Cardano preprod* — send tADA to the deposit address shown and paste the transaction hash.
   - *Exchange* — submit the exchange, amount and withdrawal id, then approve it in `/admin`.
3. Watch the deposit move from `pending` to `confirming` to `credited`. Re-check runs the validation again.
4. **Withdraw.** Enter any valid `addr_test1…` address, choose the settlement asset, check the fee and the
   amount you will receive, and confirm.
5. The withdrawal shows `submitted` with a real transaction hash, then `confirmed` once it is on chain.
6. Click the hash to open it in the Cardano preprod explorer.
7. `/evidence` lists the same records, including the failures and the duplicate-prevention counters.

## Live deployment

| | |
|---|---|
| URL | <https://wfit-gateway.anchorflow.cloud> |
| Network | Cardano **preprod** |
| Settlement vault | `addr_test1vz3scr56jxyl7qez7c8m8z75r73vuhhs0kjl8tjp06yqvjga9h60a` |
| Deposit address | `addr_test1vrldq43s4xqjnak2s04dg08v2w04cj62llxnqne683rsrpqjzdk6l` |
| Chain access | Blockfrost preprod (build + submit), Koios preprod (reads, fallback) |

### Transactions from the first end-to-end run

| Step | Transaction |
|---|---|
| Vault funded from the testnet faucet | `2959dd4a47d4e31dfa3e09d08e96e947ee94937fce52816e9691f44692d2d743` |
| Deposit paid in by a test wallet | `8f2c33b8b720def1036b5c5e57ef2b8613b7ef984549e39ed0d1970b43bc7838` |
| **Withdrawal settled by the gateway** | `3918b29a73d00d34c09eb981d970173eb537f16babedeeb0931b025a88a31623` |

120 tADA arrived, 120 credits were issued, 50 credits were redeemed at a 1% fee, and 49.5 tADA was paid
out on chain. Either explorer resolves them:
[cardanoscan](https://preprod.cardanoscan.io/) · [cexplorer](https://preprod.cexplorer.io/).

## TRL evidence

`/evidence` is generated from this deployment's own records: credited deposits with their source-chain
transaction, settled withdrawals with the Cardano preprod transaction hash linked to an explorer, rejected
deposits with the reason and zero credits, refunded and manual-review withdrawals, duplicate submissions
that were prevented, the credit conservation check, and the live reserve.

## License

MIT — see [LICENSE](LICENSE).
