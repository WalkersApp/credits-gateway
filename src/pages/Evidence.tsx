import { useEffect, useState } from "react";

import { api, fmt, shortHash, when, type EvidenceResponse, type GatewayConfig } from "../api.js";
import { StatusPill } from "../components/ui.js";

export function Evidence({ config }: { config: GatewayConfig }) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.evidence().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <><h1>TRL 5 evidence</h1><p className="lede">{error}</p></>;
  if (!data) return <><h1>TRL 5 evidence</h1><p className="lede">Loading…</p></>;

  const network = config.network.replace("cardano-", "");
  const env = data.environment;
  const txLink = (hash: string | null, url: string | null) =>
    hash ? <a href={url ?? `${config.explorerBase}/transaction/${hash}`} target="_blank" rel="noreferrer">{shortHash(hash)}</a> : "—";

  return (
    <>
      <h1>TRL 5 evidence</h1>
      <p className="lede">
        Records produced by this deployment, read live from its own database and the chain. Nothing here is an
        illustration — every transaction hash below can be checked independently in a Cardano {network} explorer.
      </p>
      <p className="sub">
        Scope: a standalone gateway deployment on Cardano {network}, with its own database, process and signing
        key. It is not connected to any production application, and no mainnet funds are reachable from it —
        the network setting refuses anything but preprod and preview. The settlement asset exercised below is
        tADA, which evidences the settlement mechanism and not stablecoin peg behaviour.
      </p>

      <h2>1 · Environment</h2>
      <div className="card">
        <dl className="kv">
          <dt>Network</dt><dd>Cardano {network}</dd>
          <dt>Gateway</dt><dd className="break"><a href={env.gatewayUrl} target="_blank" rel="noreferrer">{env.gatewayUrl}</a></dd>
          <dt>Settlement vault</dt>
          <dd className="break mono">
            {env.vaultExplorerUrl
              ? <a href={env.vaultExplorerUrl} target="_blank" rel="noreferrer">{env.vaultAddress}</a>
              : env.vaultAddress}
          </dd>
          <dt>Cardano deposit address</dt><dd className="break mono">{env.cardanoDepositAddress ?? "not configured"}</dd>
          <dt>Sepolia deposit address</dt><dd className="break mono">{env.sepoliaDepositAddress ?? "not configured"}</dd>
          <dt>Chain access</dt><dd>{env.chainAccess}</dd>
        </dl>
      </div>

      <h2>2 · Deposits that issued credits</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr><th>Route</th><th>Observed</th><th>Confirmations</th><th>Status</th><th>Credits issued</th><th>Transaction</th><th>Credited</th></tr>
          </thead>
          <tbody>
            {data.creditedDeposits.map((d) => (
              <tr key={d.id}>
                <td>{d.network}<br /><span className="sub">{d.asset}</span></td>
                <td>{fmt(d.observedUnits)}</td>
                <td className="sub">{d.confirmationsRequired ? `${d.confirmations} / ${d.confirmationsRequired}` : "manual"}</td>
                <td><StatusPill status={d.status} /></td>
                <td>{fmt(d.creditsUnits)}</td>
                <td className="mono break">{d.txHash ? txLink(d.txHash, d.explorerUrl) : <span className="sub">{d.reference ?? "—"}</span>}</td>
                <td className="sub">{when(d.creditedAt)}</td>
              </tr>
            ))}
            {data.creditedDeposits.length === 0 ? <tr><td colSpan={7} className="sub">No credited deposits yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>3 · Duplicate protection</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Original transaction</th><th>Route</th><th>Duplicate submissions</th><th>Credits issued</th></tr></thead>
          <tbody>
            {data.duplicateSubmissions.map((d) => (
              <tr key={d.id}>
                <td className="mono break">{d.txHash ? shortHash(d.txHash) : (d.reference ?? "—")}</td>
                <td className="sub">{d.network} · {d.asset}</td>
                <td>{d.duplicateSubmissions} prevented</td>
                <td>{fmt(d.creditsUnits)} — issued once</td>
              </tr>
            ))}
            {data.duplicateSubmissions.length === 0 ? <tr><td colSpan={4} className="sub">No duplicate submissions recorded.</td></tr> : null}
          </tbody>
        </table>
        <p className="sub">
          A unique index on (network, transaction hash) is what enforces this — resubmitting returns the original
          record and increments a counter. The same applies to withdrawals via their idempotency key.
        </p>
      </div>

      <h2>4 · Rejected deposits</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Route</th><th>Transaction</th><th>Status</th><th>Reason</th><th>Credits issued</th></tr></thead>
          <tbody>
            {data.rejectedDeposits.map((d) => (
              <tr key={d.id}>
                <td className="sub">{d.network} · {d.asset}</td>
                <td className="mono break">{d.txHash ? shortHash(d.txHash) : "—"}</td>
                <td><StatusPill status={d.status} /></td>
                <td className="sub">{d.rejectionReason}</td>
                <td>{fmt(d.creditsUnits ?? 0)}</td>
              </tr>
            ))}
            {data.rejectedDeposits.length === 0 ? <tr><td colSpan={5} className="sub">No rejected deposits recorded.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>5 · Settled withdrawals</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr><th>Credits used</th><th>Fee</th><th>Settled</th><th>Destination</th><th>Transaction</th><th>Status</th><th>Confirmed</th></tr>
          </thead>
          <tbody>
            {data.settledWithdrawals.map((w) => (
              <tr key={w.id}>
                <td>{fmt(w.creditsUnits)}</td>
                <td className="sub">{fmt(w.feeUnits)}</td>
                <td>{fmt(w.settlementUnits)} {w.settlementAssetId}</td>
                <td className="mono break sub">{shortHash(w.destinationAddress)}</td>
                <td className="mono break">{txLink(w.txHash, w.explorerUrl)}</td>
                <td><StatusPill status={w.status} /></td>
                <td className="sub">{when(w.confirmedAt)}</td>
              </tr>
            ))}
            {data.settledWithdrawals.length === 0 ? <tr><td colSpan={7} className="sub">No settled withdrawals yet.</td></tr> : null}
          </tbody>
        </table>
        <p className="sub">
          Credits used = settlement amount + fee. The locked credits are consumed only after the transaction is
          seen on chain, which is why the accounting below still balances.
        </p>
      </div>

      <h2>6 · Reserve safety</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Asset</th><th>On chain</th><th>Committed</th><th>Free</th><th>Critical</th><th>Minimum</th><th>Target</th><th>State</th></tr></thead>
          <tbody>
            {(data.reserve?.assets ?? []).map((a) => (
              <tr key={a.assetId}>
                <td>{a.label}</td>
                <td>{fmt(a.balanceUnits)}</td>
                <td className="sub">{fmt(a.lockedUnits)}</td>
                <td>{fmt(a.balanceUnits - a.lockedUnits)}</td>
                <td className="sub">{fmt(a.criticalUnits)}</td>
                <td className="sub">{fmt(a.minUnits)}</td>
                <td className="sub">{fmt(a.targetUnits)}</td>
                <td><span className={`pill ${a.health === "healthy" ? "good" : a.health === "low" ? "warn" : "bad"}`}>{a.health}</span></td>
              </tr>
            ))}
            {!data.reserve ? <tr><td colSpan={8} className="sub">Reserve unavailable.</td></tr> : null}
          </tbody>
        </table>
        <p className="sub">
          A withdrawal the free reserve cannot cover is refused at request time, before any credits are locked —
          the user keeps their balance and no transaction is attempted.
        </p>
      </div>

      <h2>7 · Accounting integrity</h2>
      <div className="card">
        <dl className="kv">
          <dt>Ledger supply</dt><dd>{fmt(data.integrity.ledgerSupplyUnits)} credits</dd>
          <dt>Sum of account balances</dt><dd>{fmt(data.integrity.balancesTotalUnits)} credits</dd>
          <dt>Drift</dt><dd>{fmt(data.integrity.driftUnits)}</dd>
          <dt>Result</dt>
          <dd>
            <span className={`pill ${data.integrity.ok ? "good" : "bad"}`}>{data.integrity.ok ? "balanced" : "drift detected"}</span>
            {data.integrity.problems.length > 0 ? <span className="sub"> — {data.integrity.problems.join("; ")}</span> : null}
          </dd>
          <dt>Checked</dt><dd className="sub">{when(data.integrity.checkedAt)}</dd>
        </dl>
        <p className="sub">
          Balances are a view over an append-only ledger. If this drifts from zero the gateway stops settling
          rather than paying out — a supply that does not reconcile is either a bug or tampering.
        </p>
      </div>

      <h2>8 · Withdrawals held or returned</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Status</th><th>Credits</th><th>Transaction</th><th>Reason</th></tr></thead>
          <tbody>
            {[...data.manualReviewWithdrawals, ...data.refundedWithdrawals].map((w) => (
              <tr key={w.id}>
                <td><StatusPill status={w.status} /></td>
                <td>{fmt(w.creditsUnits)}</td>
                <td className="mono break">{w.txHash ? shortHash(w.txHash) : "—"}</td>
                <td className="sub">{w.failureReason ?? "—"}</td>
              </tr>
            ))}
            {data.manualReviewWithdrawals.length + data.refundedWithdrawals.length === 0
              ? <tr><td colSpan={4} className="sub">None recorded on this deployment — no settlement has failed or been left unproven.</td></tr>
              : null}
          </tbody>
        </table>
      </div>

      <h2>9 · Failure behaviour</h2>
      <p className="sub">
        The rules the code enforces. Rows without a record above have not occurred on this deployment; they are
        covered by the test suite rather than by a live record, and we do not manufacture records to fill them.
      </p>
      <div className="card scroll">
        <table>
          <thead><tr><th>Deposit situation</th><th>Result</th><th>Credits</th></tr></thead>
          <tbody>
            {data.depositOutcomes.map((o) => (
              <tr key={o.situation}><td>{o.situation}</td><td className="sub">{o.result}</td><td>{o.credits}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card scroll">
        <table>
          <thead><tr><th>Withdrawal situation</th><th>Result</th><th>Credits</th></tr></thead>
          <tbody>
            {data.withdrawalOutcomes.map((o) => (
              <tr key={o.situation}><td>{o.situation}</td><td className="sub">{o.result}</td><td>{o.credits}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>10 · What this does and does not establish</h2>
      <div className="card">
        <ul className="plain">
          <li><strong>Established:</strong> on-chain deposit verification, idempotent credits issuance, accounting
            integrity, reserve checks, withdrawal orchestration, failure handling, and real Cardano {network}
            settlement — exercised end to end on this deployment.</li>
          <li><strong>Not established:</strong> USDM or USDCx payouts. No USDM or USDCx settlement has been made
            here. The settlement asset exercised is tADA, which proves the settlement mechanism, not peg behaviour.</li>
          <li><strong>Not automated:</strong> the exchange funding route, and the conversion of external stablecoin
            liquidity into Cardano settlement liquidity. Both are operator processes recorded by the gateway.</li>
          <li><strong>Not integrated:</strong> this is a standalone infrastructure layer. It is not wired into
            any production application, and it shares no database, wallet or process with one.</li>
          <li><strong>Independently checkable:</strong> the settlement vault address and every transaction hash
            above resolve in a public Cardano {network} explorer, without access to this deployment.</li>
        </ul>
      </div>
    </>
  );
}
