import { useCallback, useEffect, useState } from "react";

import { api, fmt, shortHash, when, type Account, type GatewayConfig } from "../api.js";
import { Field, Notice, StatusPill } from "../components/ui.js";
import type { Deposit, Rebalance, ReserveStatus, Withdrawal } from "../shared/types.js";

type Tab = "overview" | "deposits" | "withdrawals" | "reserve" | "rebalancing";

export function Admin({ config, account, onChanged }: { config: GatewayConfig; account: Account; onChanged: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<any>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [reserve, setReserve] = useState<ReserveStatus | null>(null);
  const [rebalances, setRebalances] = useState<Rebalance[]>([]);
  const [notice, setNotice] = useState("");

  const isAdmin = account.role === "admin";

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const [o, d, w, r, rb] = await Promise.all([
      api.admin.overview(), api.admin.deposits(), api.admin.withdrawals(),
      api.admin.reserve().catch(() => null), api.admin.rebalances(),
    ]);
    setOverview(o); setDeposits(d); setWithdrawals(w); setReserve(r); setRebalances(rb);
  }, [isAdmin]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setNotice(""); setError("");
    try {
      await fn();
      setNotice(message);
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    }
  };

  if (!isAdmin) {
    return (
      <>
        <h1>Admin</h1>
        <form
          className="card"
          style={{ maxWidth: 420 }}
          onSubmit={async (e) => {
            e.preventDefault();
            try { await api.adminLogin(password); await onChanged(); } catch (err) { setError(err instanceof Error ? err.message : "Failed."); }
          }}
        >
          <Field label="Admin password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="row"><button type="submit">Sign in</button></div>
        </form>
      </>
    );
  }

  const manualDeposits = deposits.filter((d) => d.verification === "manual_admin");

  return (
    <>
      <h1>Admin</h1>
      <div className="row" style={{ marginTop: 0 }}>
        {(["overview", "deposits", "withdrawals", "reserve", "rebalancing"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "" : "secondary"} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {notice ? <Notice kind="ok">{notice}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}

      {tab === "overview" && overview ? (
        <div className="grid two" style={{ marginTop: 18 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Counts</h3>
            <dl className="kv">
              <dt>Users</dt><dd>{overview.users}</dd>
              <dt>Deposits</dt><dd>{Object.entries(overview.deposits).map(([k, v]) => `${k}: ${v}`).join(" · ") || "none"}</dd>
              <dt>Withdrawals</dt><dd>{Object.entries(overview.withdrawals).map(([k, v]) => `${k}: ${v}`).join(" · ") || "none"}</dd>
            </dl>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Credit accounting</h3>
            <dl className="kv">
              <dt>Balances</dt><dd>{fmt(overview.integrity.balancesTotalUnits)}</dd>
              <dt>Ledger supply</dt><dd>{fmt(overview.integrity.ledgerSupplyUnits)}</dd>
              <dt>Drift</dt>
              <dd>{fmt(overview.integrity.driftUnits)} <span className={`pill ${overview.integrity.ok ? "good" : "bad"}`}>{overview.integrity.ok ? "balanced" : "problem"}</span></dd>
            </dl>
            {overview.integrity.problems?.length ? <ul className="sub">{overview.integrity.problems.map((p: string) => <li key={p}>{p}</li>)}</ul> : null}
          </div>
        </div>
      ) : null}

      {tab === "deposits" ? (
        <>
          <h2>Exchange deposits awaiting verification</h2>
          <div className="card scroll">
            <table>
              <thead><tr><th>Exchange</th><th>Reference</th><th>Declared</th><th>Status</th><th>When</th><th></th></tr></thead>
              <tbody>
                {manualDeposits.map((d) => (
                  <tr key={d.id}>
                    <td>{d.exchange}</td>
                    <td className="mono break">{d.reference}</td>
                    <td>{fmt(d.declaredUnits)}</td>
                    <td><StatusPill status={d.status} />{d.rejectionReason ? <div className="sub">{d.rejectionReason}</div> : null}</td>
                    <td className="sub">{when(d.createdAt)}</td>
                    <td>
                      {d.status === "pending" ? (
                        <div className="row" style={{ marginTop: 0 }}>
                          <button onClick={() => void act(() => api.admin.approve(d.id), "Deposit approved and credited.")}>Approve</button>
                          <button className="secondary" onClick={() => void act(() => api.admin.reject(d.id, prompt("Reason?") ?? "Rejected by admin."), "Deposit rejected.")}>Reject</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {manualDeposits.length === 0 ? <tr><td colSpan={6} className="sub">Nothing waiting.</td></tr> : null}
              </tbody>
            </table>
          </div>

          <h2>All deposits</h2>
          <div className="card scroll">
            <table>
              <thead><tr><th>Route</th><th>Verified</th><th>Credits</th><th>Status</th><th>Reference</th><th>Dupes</th></tr></thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.id}>
                    <td>{d.network} · {d.asset}</td>
                    <td>{fmt(d.observedUnits)}</td>
                    <td>{fmt(d.creditsUnits)}</td>
                    <td><StatusPill status={d.status} /></td>
                    <td className="mono break">{d.txHash ? shortHash(d.txHash) : d.reference}</td>
                    <td>{d.duplicateSubmissions || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "withdrawals" ? (
        <div className="card scroll" style={{ marginTop: 18 }}>
          <table>
            <thead><tr><th>Credits</th><th>Settlement</th><th>Status</th><th>Transaction</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              {withdrawals.map((w) => (
                <tr key={w.id}>
                  <td>{fmt(w.creditsUnits)}</td>
                  <td>{fmt(w.settlementUnits)} {w.settlementAssetId}</td>
                  <td><StatusPill status={w.status} /></td>
                  <td className="mono break">
                    {w.txHash ? <a href={`${config.explorerBase}/transaction/${w.txHash}`} target="_blank" rel="noreferrer">{shortHash(w.txHash)}</a> : "—"}
                  </td>
                  <td className="sub">{w.failureReason ?? "—"}</td>
                  <td>
                    <div className="row" style={{ marginTop: 0 }}>
                      {w.status === "pending" ? <button onClick={() => void act(() => api.admin.settle(w.id), "Settlement attempted.")}>Settle</button> : null}
                      {w.status === "submitted" || w.status === "manual_review" ? (
                        <button className="secondary" onClick={() => void act(() => api.admin.confirm(w.id), "Checked on chain.")}>Check chain</button>
                      ) : null}
                      {w.status === "manual_review" ? (
                        <button className="secondary" onClick={() => void act(() => api.admin.release(w.id, prompt("Note — confirm the transaction never landed:") ?? ""), "Credits released.")}>
                          Release credits
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {withdrawals.length === 0 ? <tr><td colSpan={6} className="sub">No withdrawals yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "reserve" ? (
        <div className="card" style={{ marginTop: 18 }}>
          {reserve ? (
            <>
              <dl className="kv">
                <dt>Network</dt><dd>{reserve.network}</dd>
                <dt>Vault address</dt><dd className="mono break">{reserve.vaultAddress}</dd>
                <dt>Custody</dt><dd>Custodial hot wallet. Signing key held server-side, outside the repository.</dd>
              </dl>
              <div className="scroll" style={{ marginTop: 14 }}>
                <table>
                  <thead><tr><th>Asset</th><th>Balance</th><th>Committed</th><th>Minimum</th><th>Target</th><th>Health</th></tr></thead>
                  <tbody>
                    {reserve.assets.map((a) => (
                      <tr key={a.assetId}>
                        <td>{a.label}</td>
                        <td>{fmt(a.balanceUnits)}</td>
                        <td>{fmt(a.lockedUnits)}</td>
                        <td>{fmt(a.minUnits)}</td>
                        <td>{fmt(a.targetUnits)}</td>
                        <td><StatusPill status={a.health} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p className="sub" style={{ margin: 0 }}>Reserve unavailable.</p>}
        </div>
      ) : null}

      {tab === "rebalancing" ? <Rebalancing rebalances={rebalances} onDone={load} config={config} /> : null}
    </>
  );
}

function Rebalancing({ rebalances, onDone, config }: { rebalances: Rebalance[]; onDone: () => Promise<void>; config: GatewayConfig }) {
  const [form, setForm] = useState({
    sourceNetwork: "ethereum-sepolia", sourceAsset: "USDC", sourceAmount: "",
    provider: "", destinationAssetId: config.settlementAssets[0]?.id ?? "", expectedAmount: "", reference: "", note: "",
  });
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <h2>Record a rebalance</h2>
      <p className="sub" style={{ marginTop: 0 }}>
        External liquidity is converted into Cardano settlement liquidity off this system. Recording it here keeps the
        reserve's history auditable — the gateway does not claim to convert anything automatically.
      </p>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try { await api.admin.createRebalance(form); await onDone(); } catch (err) { setError(err instanceof Error ? err.message : "Failed."); }
        }}
      >
        <div className="grid two">
          <Field label="Source network"><input value={form.sourceNetwork} onChange={set("sourceNetwork")} /></Field>
          <Field label="Source asset"><input value={form.sourceAsset} onChange={set("sourceAsset")} /></Field>
          <Field label="Source amount"><input value={form.sourceAmount} onChange={set("sourceAmount")} /></Field>
          <Field label="Provider" hint="Who actually moved or converted the value."><input value={form.provider} onChange={set("provider")} /></Field>
          <Field label="Destination settlement asset">
            <select value={form.destinationAssetId} onChange={set("destinationAssetId")}>
              {config.settlementAssets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="Expected amount"><input value={form.expectedAmount} onChange={set("expectedAmount")} /></Field>
          <Field label="Reference"><input value={form.reference} onChange={set("reference")} /></Field>
          <Field label="Note"><input value={form.note} onChange={set("note")} /></Field>
        </div>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <div className="row"><button type="submit">Record</button></div>
      </form>

      <h2>Recorded rebalances</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Raised by</th><th>Source</th><th>Provider</th><th>Destination</th><th>Expected</th><th>Actual</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rebalances.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className={`pill ${r.origin === "auto" ? "warn" : ""}`}>{r.origin === "auto" ? "threshold" : "admin"}</span>
                  {r.trigger ? (
                    <div className="sub">
                      free {fmt(r.trigger.availableUnits)} below min {fmt(r.trigger.minUnits)}
                    </div>
                  ) : null}
                </td>
                <td>{r.sourceAmount} {r.sourceAsset} · {r.sourceNetwork}</td>
                <td>{r.provider}</td>
                <td>{r.destinationAssetId}</td>
                <td>{r.expectedAmount}</td>
                <td>{r.actualAmount ?? "—"}</td>
                <td><StatusPill status={r.status} /></td>
                <td>
                  <div className="row" style={{ marginTop: 0 }}>
                    {r.status !== "completed" && r.status !== "failed" ? (
                      <>
                        <button className="secondary" onClick={async () => { await api.admin.updateRebalance(r.id, { status: "processing" }); await onDone(); }}>Processing</button>
                        <button className="secondary" onClick={async () => {
                          const actualAmount = prompt("Actual amount received?") ?? "";
                          await api.admin.updateRebalance(r.id, { status: "completed", actualAmount });
                          await onDone();
                        }}>Complete</button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {rebalances.length === 0 ? <tr><td colSpan={8} className="sub">Nothing recorded yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
