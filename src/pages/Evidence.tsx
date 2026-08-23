import { useEffect, useState } from "react";

import { api, fmt, shortHash, when, type EvidenceResponse, type GatewayConfig } from "../api.js";
import { StatusPill } from "../components/ui.js";

export function Evidence({ config }: { config: GatewayConfig }) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.evidence().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <><h1>TRL evidence</h1><p className="lede">{error}</p></>;
  if (!data) return <><h1>TRL evidence</h1><p className="lede">Loading…</p></>;

  const network = config.network.replace("cardano-", "");

  return (
    <>
      <h1>TRL evidence</h1>
      <p className="lede">
        Records produced by this deployment, not illustrations. Transaction hashes link to the Cardano {network}
        explorer, so every settlement below can be checked independently.
      </p>

      <h2>Settled withdrawals on Cardano {network}</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Account</th><th>Credits</th><th>Settled</th><th>Destination</th><th>Transaction</th><th>Confirmed</th></tr></thead>
          <tbody>
            {data.settledWithdrawals.map((w) => (
              <tr key={w.id}>
                <td className="sub">{w.account}</td>
                <td>{fmt(w.creditsUnits)}</td>
                <td>{fmt(w.settlementUnits)} {w.settlementAssetId}</td>
                <td className="mono break">{w.destinationAddress.slice(0, 20)}…</td>
                <td className="mono break">
                  {w.explorerUrl ? <a href={w.explorerUrl} target="_blank" rel="noreferrer">{shortHash(w.txHash)}</a> : shortHash(w.txHash)}
                </td>
                <td className="sub">{when(w.confirmedAt)}</td>
              </tr>
            ))}
            {data.settledWithdrawals.length === 0 ? (
              <tr><td colSpan={6} className="sub">No settlement has confirmed yet on this deployment.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2>Deposits that issued credits</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Account</th><th>Route</th><th>Verified amount</th><th>Credits issued</th><th>Reference</th><th>When</th></tr></thead>
          <tbody>
            {data.creditedDeposits.map((d) => (
              <tr key={d.id}>
                <td className="sub">{d.account}</td>
                <td>{d.network} · {d.asset}</td>
                <td>{fmt(d.observedUnits)}</td>
                <td>{fmt(d.creditsUnits)}</td>
                <td className="mono break">
                  {d.txHash && d.network === "ethereum-sepolia"
                    ? <a href={`${config.sepoliaExplorerBase}/tx/${d.txHash}`} target="_blank" rel="noreferrer">{shortHash(d.txHash)}</a>
                    : d.txHash
                      ? <a href={`${config.explorerBase}/transaction/${d.txHash}`} target="_blank" rel="noreferrer">{shortHash(d.txHash)}</a>
                      : d.reference}
                </td>
                <td className="sub">{when(d.creditedAt)}</td>
              </tr>
            ))}
            {data.creditedDeposits.length === 0 ? <tr><td colSpan={6} className="sub">No credited deposits yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Rejected and failed deposits</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Account</th><th>Route</th><th>Status</th><th>Reason</th><th>Credits issued</th></tr></thead>
          <tbody>
            {data.rejectedDeposits.map((d) => (
              <tr key={d.id}>
                <td className="sub">{d.account}</td>
                <td>{d.network} · {d.asset}</td>
                <td><StatusPill status={d.status} /></td>
                <td className="sub">{d.rejectionReason ?? "—"}</td>
                <td>{fmt(d.creditsUnits ?? 0)}</td>
              </tr>
            ))}
            {data.rejectedDeposits.length === 0 ? <tr><td colSpan={5} className="sub">None yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Duplicate protection</h2>
      <div className="card scroll">
        <p className="sub" style={{ marginTop: 0 }}>
          Re-submitting a transaction that is already registered returns the original deposit. The counter is how
          many times that happened for each record.
        </p>
        <table>
          <thead><tr><th>Original deposit</th><th>Reference</th><th>Credits issued</th><th>Duplicate attempts</th></tr></thead>
          <tbody>
            {data.duplicateSubmissions.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.id.slice(0, 8)}</td>
                <td className="mono break">{d.txHash ? shortHash(d.txHash) : d.reference}</td>
                <td>{fmt(d.creditsUnits)}</td>
                <td>{d.duplicateSubmissions}</td>
              </tr>
            ))}
            {data.duplicateSubmissions.length === 0 ? <tr><td colSpan={4} className="sub">No duplicate submissions recorded yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Failed withdrawals and refunds</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Account</th><th>Credits</th><th>Status</th><th>Reason</th><th>Refunded</th></tr></thead>
          <tbody>
            {[...data.refundedWithdrawals, ...data.manualReviewWithdrawals].map((w) => (
              <tr key={w.id}>
                <td className="sub">{w.account}</td>
                <td>{fmt(w.creditsUnits)}</td>
                <td><StatusPill status={w.status} /></td>
                <td className="sub">{w.failureReason ?? "—"}</td>
                <td className="sub">{when(w.refundedAt)}</td>
              </tr>
            ))}
            {data.refundedWithdrawals.length + data.manualReviewWithdrawals.length === 0 ? (
              <tr><td colSpan={5} className="sub">None yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2>Credit accounting</h2>
      <div className="card">
        <dl className="kv">
          <dt>Balances across all accounts</dt><dd>{fmt(data.integrity.balancesTotalUnits)} credits</dd>
          <dt>Ledger supply (issued − consumed)</dt><dd>{fmt(data.integrity.ledgerSupplyUnits)} credits</dd>
          <dt>Drift</dt>
          <dd>
            {fmt(data.integrity.driftUnits)}{" "}
            <span className={`pill ${data.integrity.ok ? "good" : "bad"}`}>{data.integrity.ok ? "balanced" : "check failed"}</span>
          </dd>
          <dt>Checked</dt><dd>{when(data.integrity.checkedAt)}</dd>
        </dl>
        {data.integrity.problems.length ? (
          <ul className="sub">{data.integrity.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        ) : null}
      </div>

      <h2>Settlement reserve</h2>
      <div className="card">
        {data.reserve ? (
          <>
            <dl className="kv">
              <dt>Network</dt><dd>{data.reserve.network}</dd>
              <dt>Vault address</dt>
              <dd className="break mono">
                <a href={`${config.explorerBase}/address/${data.reserve.vaultAddress}`} target="_blank" rel="noreferrer">
                  {data.reserve.vaultAddress}
                </a>
              </dd>
            </dl>
            <div className="scroll" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Asset</th><th>Balance</th><th>Committed</th><th>Minimum</th><th>Health</th></tr></thead>
                <tbody>
                  {data.reserve.assets.map((a) => (
                    <tr key={a.assetId}>
                      <td>{a.label} {a.official ? null : <span className="pill warn">test asset</span>}</td>
                      <td>{fmt(a.balanceUnits)}</td>
                      <td>{fmt(a.lockedUnits)}</td>
                      <td>{fmt(a.minUnits)}</td>
                      <td><StatusPill status={a.health} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <p className="sub" style={{ margin: 0 }}>The reserve could not be read from the chain right now.</p>}
      </div>
    </>
  );
}
