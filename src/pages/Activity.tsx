import { useEffect, useState } from "react";

import { api, fmt, shortHash, when, type GatewayConfig } from "../api.js";
import { StatusPill } from "../components/ui.js";
import type { Deposit, LedgerEntry, Withdrawal } from "../shared/types.js";

export function Activity({ config }: { config: GatewayConfig }) {
  const [data, setData] = useState<{ deposits: Deposit[]; withdrawals: Withdrawal[]; ledger: LedgerEntry[] } | null>(null);

  useEffect(() => { api.transactions().then(setData).catch(() => undefined); }, []);
  if (!data) return <p className="lede" style={{ marginTop: 40 }}>Loading…</p>;

  return (
    <>
      <h1>Activity</h1>
      <p className="lede">Every credit movement, with the deposit or withdrawal it belongs to.</p>

      <h2>Credit ledger</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>#</th><th>Type</th><th>Direction</th><th>Amount</th><th>Available after</th><th>Locked after</th><th>When</th></tr></thead>
          <tbody>
            {data.ledger.map((e) => (
              <tr key={e.id}>
                <td className="sub">{e.seq}</td>
                <td>{e.kind}</td>
                <td>{e.direction}</td>
                <td>{fmt(e.amountUnits)}</td>
                <td>{fmt(e.availableAfterUnits)}</td>
                <td>{fmt(e.lockedAfterUnits)}</td>
                <td className="sub">{when(e.createdAt)}</td>
              </tr>
            ))}
            {data.ledger.length === 0 ? <tr><td colSpan={7} className="sub">No entries yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Deposits</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Route</th><th>Verified amount</th><th>Credits</th><th>Status</th><th>Reference</th><th>When</th></tr></thead>
          <tbody>
            {data.deposits.map((d) => (
              <tr key={d.id}>
                <td>{d.network} · {d.asset}</td>
                <td>{fmt(d.observedUnits)}</td>
                <td>{fmt(d.creditsUnits)}</td>
                <td><StatusPill status={d.status} /></td>
                <td className="mono break">{d.txHash ? shortHash(d.txHash) : d.reference ?? "—"}</td>
                <td className="sub">{when(d.createdAt)}</td>
              </tr>
            ))}
            {data.deposits.length === 0 ? <tr><td colSpan={6} className="sub">No deposits yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Withdrawals</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Credits</th><th>Settlement</th><th>Status</th><th>Transaction</th><th>When</th></tr></thead>
          <tbody>
            {data.withdrawals.map((w) => (
              <tr key={w.id}>
                <td>{fmt(w.creditsUnits)}</td>
                <td>{fmt(w.settlementUnits)} {w.settlementAssetId}</td>
                <td><StatusPill status={w.status} /></td>
                <td className="mono break">
                  {w.txHash ? <a href={`${config.explorerBase}/transaction/${w.txHash}`} target="_blank" rel="noreferrer">{shortHash(w.txHash)}</a> : "—"}
                </td>
                <td className="sub">{when(w.createdAt)}</td>
              </tr>
            ))}
            {data.withdrawals.length === 0 ? <tr><td colSpan={5} className="sub">No withdrawals yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
