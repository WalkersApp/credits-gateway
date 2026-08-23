import { useEffect, useState } from "react";

import { api, fmt, shortHash, when, type Account, type GatewayConfig } from "../api.js";
import { Flow, StatusPill } from "../components/ui.js";
import type { Deposit, Withdrawal } from "../shared/types.js";

export function Dashboard({
  config, account, go, onSignOut,
}: {
  config: GatewayConfig;
  account: Account;
  go: (to: string) => void;
  onSignOut: () => Promise<void>;
}) {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  useEffect(() => {
    api.transactions().then((t) => {
      setDeposits(t.deposits.slice(0, 5));
      setWithdrawals(t.withdrawals.slice(0, 5));
    }).catch(() => undefined);
  }, []);

  const balance = account.balance ?? { availableUnits: 0, lockedUnits: 0 };

  return (
    <>
      <h1>Credits</h1>
      <div className="grid two">
        <div className="card">
          <div className="balance">{fmt(balance.availableUnits)}<span>credits available</span></div>
          <div className="sub">{fmt(balance.lockedUnits)} locked in withdrawals being settled</div>
          <div className="row">
            <button onClick={() => go("/fund")}>Fund credits</button>
            <button className="secondary" onClick={() => go("/withdraw")}>Withdraw to Cardano</button>
          </div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>How this works</h3>
          <Flow active={null} />
          <p className="sub" style={{ marginTop: 12 }}>
            One credit represents one US dollar of validated deposit value, before fees. Credits are an internal
            accounting balance; withdrawing settles a real transaction on Cardano {config.network.replace("cardano-", "")}.
          </p>
          <div className="sub">Signed in as {account.email} · <a href="#" onClick={(e) => { e.preventDefault(); void onSignOut(); }}>sign out</a></div>
        </div>
      </div>

      <h2>Recent activity</h2>
      <div className="card scroll">
        {deposits.length === 0 && withdrawals.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>Nothing yet. Fund some credits to get started.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Type</th><th>Amount</th><th>Status</th><th>Reference</th><th>When</th></tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id}>
                  <td>Deposit · {d.asset}</td>
                  <td>{fmt(d.creditsUnits ?? d.observedUnits ?? d.declaredUnits)} </td>
                  <td><StatusPill status={d.status} /></td>
                  <td className="mono break">{d.txHash ? shortHash(d.txHash) : d.reference ?? "—"}</td>
                  <td className="sub">{when(d.createdAt)}</td>
                </tr>
              ))}
              {withdrawals.map((w) => (
                <tr key={w.id}>
                  <td>Withdrawal</td>
                  <td>{fmt(w.creditsUnits)} credits</td>
                  <td><StatusPill status={w.status} /></td>
                  <td className="mono break">
                    {w.txHash ? (
                      <a href={`${config.explorerBase}/transaction/${w.txHash}`} target="_blank" rel="noreferrer">{shortHash(w.txHash)}</a>
                    ) : "—"}
                  </td>
                  <td className="sub">{when(w.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
