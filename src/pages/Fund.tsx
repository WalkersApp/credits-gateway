import { useEffect, useMemo, useState } from "react";

import { api, fmt, shortHash, when, type GatewayConfig } from "../api.js";
import { Field, Flow, Notice, StatusPill } from "../components/ui.js";
import type { Deposit } from "../shared/types.js";

export function Fund({ config, onChanged }: { config: GatewayConfig; onChanged: () => Promise<void> }) {
  const routes = useMemo(() => config.routes.filter((r) => r.enabled), [config.routes]);
  const [routeId, setRouteId] = useState(routes[0]?.id ?? "");
  const [txHash, setTxHash] = useState("");
  const [amount, setAmount] = useState("");
  const [exchange, setExchange] = useState(config.exchanges[0] ?? "");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Deposit | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);

  const route = routes.find((r) => r.id === routeId);
  const manual = route?.verification === "manual_admin";

  const load = () => api.deposits().then(setDeposits).catch(() => undefined);
  useEffect(() => { void load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      const deposit = await api.createDeposit(
        manual ? { routeId, exchange, reference, amount } : { routeId, txHash, amount: amount || undefined },
      );
      setResult(deposit);
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the deposit.");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (id: string) => {
    const updated = await api.refreshDeposit(id);
    setResult(updated);
    await Promise.all([load(), onChanged()]);
  };

  return (
    <>
      <h1>Fund credits</h1>
      <p className="lede">
        Send funds on one of the routes below, then tell the gateway about it. The amount credited is always the
        amount the gateway verified — never the amount typed here.
      </p>
      <Flow active="funding" />

      <div className="grid two" style={{ marginTop: 20 }}>
        <form className="card" onSubmit={submit}>
          <Field label="Route">
            <select value={routeId} onChange={(e) => { setRouteId(e.target.value); setResult(null); }}>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.networkLabel} · {r.asset}</option>)}
            </select>
          </Field>

          {route ? (
            <>
              <div className="sub" style={{ marginTop: 10 }}>{route.notes}</div>
              {route.depositAddress ? (
                <Field label="Deposit address" hint={`${route.confirmationsRequired} confirmations required`}>
                  <input className="mono" readOnly value={route.depositAddress} onFocus={(e) => e.currentTarget.select()} />
                </Field>
              ) : null}
            </>
          ) : null}

          {manual ? (
            <>
              <Field label="Exchange">
                <select value={exchange} onChange={(e) => setExchange(e.target.value)}>
                  {config.exchanges.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Withdrawal id or transaction hash" hint="Whatever the exchange gave you as a reference.">
                <input value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <Field label="Amount withdrawn">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" />
              </Field>
              <Notice kind="info">
                Exchange deposits are verified by a person. No exchange API is connected — an admin checks the
                reference against the exchange record and approves it. Credits appear only after approval.
              </Notice>
            </>
          ) : (
            <>
              <Field label="Transaction hash">
                <input className="mono" value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x… or Cardano tx hash" />
              </Field>
              <Field label="Amount sent (optional)" hint="Only used to flag a mismatch. The credited amount comes from the chain.">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" />
              </Field>
            </>
          )}

          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="row">
            <button type="submit" disabled={busy || !routeId}>{busy ? "Checking…" : "Submit deposit"}</button>
          </div>
        </form>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>What happens next</h3>
          <ol className="sub" style={{ paddingLeft: 18, margin: 0 }}>
            <li>The gateway looks up the transaction on the source chain.</li>
            <li>It reads the amount that actually arrived at the gateway's address.</li>
            <li>It waits for the route's confirmation target.</li>
            <li>Credits are issued once, against that transaction.</li>
          </ol>
          {result ? (
            <div style={{ marginTop: 16 }}>
              <div className="row" style={{ marginTop: 0 }}>
                <StatusPill status={result.status} />
                <span className="sub">{result.confirmations}/{result.confirmationsRequired} confirmations</span>
                <button className="secondary" onClick={() => void refresh(result.id)}>Re-check</button>
              </div>
              {result.rejectionReason ? <Notice kind="error">{result.rejectionReason}</Notice> : null}
              {result.status === "credited" ? (
                <Notice kind="ok">{fmt(result.creditsUnits)} credits issued.</Notice>
              ) : null}
              {result.duplicateSubmissions > 0 ? (
                <Notice kind="info">
                  This transaction was already registered — submitting it again returned the original deposit
                  ({result.duplicateSubmissions} duplicate {result.duplicateSubmissions === 1 ? "attempt" : "attempts"}).
                </Notice>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <h2>Your deposits</h2>
      <div className="card scroll">
        {deposits.length === 0 ? <p className="sub" style={{ margin: 0 }}>No deposits yet.</p> : (
          <table>
            <thead><tr><th>Route</th><th>Seen</th><th>Credits</th><th>Status</th><th>Reference</th><th>When</th><th></th></tr></thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id}>
                  <td>{d.network} · {d.asset}</td>
                  <td>{fmt(d.observedUnits)}</td>
                  <td>{fmt(d.creditsUnits)}</td>
                  <td><StatusPill status={d.status} />{d.rejectionReason ? <div className="sub">{d.rejectionReason}</div> : null}</td>
                  <td className="mono break">{d.txHash ? shortHash(d.txHash) : d.reference}</td>
                  <td className="sub">{when(d.createdAt)}</td>
                  <td>
                    {d.verification === "onchain_automatic" && d.status !== "credited" && d.status !== "rejected" ? (
                      <button className="secondary" onClick={() => void refresh(d.id)}>Re-check</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
