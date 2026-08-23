import { useEffect, useState } from "react";

import { api, fmt, type GatewayConfig } from "../api.js";
import type { ReserveStatus } from "../shared/types.js";

export function Architecture({ config }: { config: GatewayConfig }) {
  const [reserve, setReserve] = useState<ReserveStatus | null>(null);
  useEffect(() => { api.reserve().then(setReserve).catch(() => undefined); }, []);

  const network = config.network.replace("cardano-", "");

  return (
    <>
      <h1>Technical architecture</h1>
      <p className="lede">
        How external stablecoin value becomes WFIT credits, and how credits are settled back out on Cardano {network}.
      </p>

      <div className="card">
        <div className="diagram">
          <div className="node">External stablecoin or exchange withdrawal</div>
          <div className="down">↓</div>
          <div className="node">Deposit validation — the gateway reads the source chain</div>
          <div className="down">↓</div>
          <div className="node accent">WFIT credits (internal ledger, 1 credit = 1 USD before fees)</div>
          <div className="down">↓</div>
          <div className="node">Cardano {network} settlement reserve (custodial hot wallet)</div>
          <div className="down">↓</div>
          <div className="node">Settlement asset: {config.settlementAssets.filter((a) => a.enabled).map((a) => a.label).join(" / ")}</div>
          <div className="down">↓</div>
          <div className="node">User-controlled Cardano address</div>
        </div>
      </div>

      <h2>Funding routes</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr><th>Network</th><th>Asset</th><th>Provider</th><th>Verification</th><th>Confirmations</th><th>State</th></tr>
          </thead>
          <tbody>
            {config.routes.map((r) => (
              <tr key={r.id}>
                <td>{r.networkLabel}</td>
                <td>{r.asset}</td>
                <td>{r.provider}</td>
                <td>{r.verification === "onchain_automatic" ? "automatic, on chain" : "manual, admin approval"}</td>
                <td>{r.confirmationsRequired || "—"}</td>
                <td><span className={`pill ${r.enabled ? "good" : "wait"}`}>{r.enabled ? "live" : "not enabled"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Custody</h2>
      <div className="card">
        <dl className="kv">
          <dt>Incoming deposits</dt>
          <dd>
            Held at the gateway's own deposit addresses — one per source chain. These are custodial addresses
            controlled by the gateway operator, kept separate from the settlement reserve so incoming value and
            outgoing liquidity are accounted for independently.
          </dd>
          <dt>Settlement reserve</dt>
          <dd className="break">
            {reserve?.vaultAddress ?? config.vaultAddress} on Cardano {network}. A custodial hot wallet: the signing
            key is held server-side, outside the repository, readable only by the gateway process.
          </dd>
          <dt>Who controls it</dt>
          <dd>The gateway operator. This is a custodial preprod reserve — there is no smart-contract vault or
            multi-signature scheme in this reference implementation, and we do not describe it as non-custodial.</dd>
          <dt>What a credit is</dt>
          <dd>An internal accounting entry representing validated deposit value. It is not a token, it is not
            transferable between users, and it only leaves the system through a settlement transaction.</dd>
        </dl>
      </div>

      <h2>Conversion</h2>
      <div className="card">
        <p className="sub" style={{ marginTop: 0 }}>
          External value becomes credits when a deposit is validated: the gateway reads the amount that actually
          arrived, applies the route's server-side rate and deposit fee, and issues that many credits once against
          that transaction. Credits become a settlement asset at a server-side rate when a withdrawal is confirmed.
          The client never supplies a rate — a rate sent by a browser is ignored.
        </p>
        <div className="scroll">
          <table>
            <thead><tr><th>Settlement asset</th><th>Rate</th><th>Status</th><th>Basis</th></tr></thead>
            <tbody>
              {config.settlementAssets.map((a) => (
                <tr key={a.id}>
                  <td>{a.label}</td>
                  <td>{a.rateBps / 10_000} per credit</td>
                  <td><span className={`pill ${a.official ? "good" : "warn"}`}>{a.official ? "official asset" : "test asset"}</span></td>
                  <td className="sub">{a.officialityNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">
          There is no official USDM deployment on Cardano {network}: Moneta publishes a mainnet policy id only.
          USDCx exists on mainnet under a published Circle/IOG policy; the preprod asset named USDCx is registered
          in the Cardano Foundation preprod token metadata registry but no official source ties that policy id to
          Circle, so this gateway treats it as a test asset representing the settlement path.
        </p>
      </div>

      <h2>Liquidity and rebalancing</h2>
      <div className="card">
        <dl className="kv">
          <dt>Reserve thresholds</dt>
          <dd>
            {reserve?.assets[0]
              ? `Target ${fmt(reserve.assets[0].targetUnits)} · minimum ${fmt(reserve.assets[0].minUnits)} (per settlement asset).`
              : "Configured per settlement asset."}{" "}
            Below the minimum the reserve reads <strong>low</strong>; well below it reads <strong>critical</strong>.
          </dd>
          <dt>When liquidity is short</dt>
          <dd>
            A withdrawal that the reserve cannot cover is refused before any credits are locked, or — if the reserve
            drops between the check and the build — parked as pending with the credits locked safely. No transaction
            is attempted that cannot succeed, and no credits are destroyed.
          </dd>
          <dt>Rebalancing</dt>
          <dd>
            Incoming external stablecoin liquidity is converted into Cardano settlement liquidity as a recorded
            operational process: an admin books the source network, asset and amount, the provider used, the expected
            and actual amounts, and the reference. There is no automated conversion in this implementation and we do
            not claim one.
          </dd>
        </dl>
      </div>

      <h2>Failures and refunds</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Situation</th><th>What the gateway does</th></tr></thead>
          <tbody>
            <tr><td>Unsupported or unrecognised deposit</td><td>Rejected. No credits.</td></tr>
            <tr><td>Deposit not yet confirmed</td><td>Stays pending / confirming. No credits until the confirmation target is met.</td></tr>
            <tr><td>Same transaction submitted twice</td><td>A unique index on (network, transaction hash) returns the original deposit. Credits are issued once.</td></tr>
            <tr><td>Amount below the route minimum</td><td>Rejected with the reason. No credits.</td></tr>
            <tr><td>Exchange deposit rejected by an admin</td><td>Rejected. No credits.</td></tr>
            <tr><td>Withdrawal fails before broadcast</td><td>Locked credits are released back to available.</td></tr>
            <tr><td>Reserve cannot cover the settlement</td><td>No transaction is attempted. Credits stay available or locked, never lost.</td></tr>
            <tr><td>Node rejects the transaction on first submit</td><td>Provably never broadcast — credits are released.</td></tr>
            <tr><td>Broadcast outcome unknown</td><td>Marked manual review with the transaction hash. Credits stay locked and are never refunded automatically.</td></tr>
            <tr><td>Settlement confirmed</td><td>Locked credits are consumed and the transaction hash is stored against the withdrawal.</td></tr>
            <tr><td>Repeated API calls</td><td>Every value-moving operation carries a unique idempotency key, so retries cannot double-credit, double-pay or double-refund.</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
