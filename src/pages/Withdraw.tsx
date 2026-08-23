import { useEffect, useMemo, useState } from "react";

import { api, fmt, shortHash, when, type Account, type GatewayConfig } from "../api.js";
import { Field, Flow, Notice, StatusPill } from "../components/ui.js";
import type { Withdrawal } from "../shared/types.js";

export function Withdraw({
  config, account, onChanged,
}: { config: GatewayConfig; account: Account; onChanged: () => Promise<void> }) {
  const assets = useMemo(() => config.settlementAssets.filter((a) => a.enabled), [config.settlementAssets]);
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [quote, setQuote] = useState<{ feeUnits: number; netCreditsUnits: number; settlementUnits: number } | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  const asset = assets.find((a) => a.id === assetId);
  const load = () => api.withdrawals().then(setWithdrawals).catch(() => undefined);
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!amount || !assetId) { setQuote(null); setQuoteError(""); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.quote(amount, assetId)
        .then((q) => { if (!cancelled) { setQuote(q); setQuoteError(""); } })
        .catch((err) => { if (!cancelled) { setQuote(null); setQuoteError(err.message); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [amount, assetId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api.createWithdrawal({ amount, settlementAssetId: assetId, destinationAddress: address }, crypto.randomUUID());
      setAmount(""); setQuote(null);
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Withdraw to Cardano</h1>
      <p className="lede">
        Credits are settled from the gateway's {config.network.replace("cardano-", "")} reserve to any valid Cardano
        address — it does not have to be an address you signed in with.
      </p>
      <Flow active="settlement" />

      <div className="grid two" style={{ marginTop: 20 }}>
        <form className="card" onSubmit={submit}>
          <Field label="Settlement asset">
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </Field>
          {asset ? (
            <div className="sub" style={{ marginTop: 8 }}>
              <span className={`pill ${asset.official ? "good" : "warn"}`}>{asset.official ? "official asset" : "test asset"}</span>{" "}
              {asset.officialityNote}
            </div>
          ) : null}

          <Field label="Destination Cardano address">
            <input className="mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="addr_test1…" />
          </Field>

          <Field label="Credits to withdraw" hint={`You have ${fmt(account.balance?.availableUnits ?? 0)} available.`}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10.00" />
          </Field>

          {quote ? (
            <dl className="kv" style={{ marginTop: 16 }}>
              <dt>Fee</dt><dd>{fmt(quote.feeUnits)} credits</dd>
              <dt>Credits debited</dt><dd>{fmt(quote.netCreditsUnits + quote.feeUnits)}</dd>
              <dt>You receive</dt><dd>{fmt(quote.settlementUnits, asset?.decimals ?? 6)} {asset?.label}</dd>
            </dl>
          ) : null}
          {quoteError ? <Notice kind="error">{quoteError}</Notice> : null}
          {error ? <Notice kind="error">{error}</Notice> : null}

          <div className="row">
            <button type="submit" disabled={busy || !quote || !address}>{busy ? "Settling…" : "Confirm withdrawal"}</button>
          </div>
        </form>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>How settlement is handled</h3>
          <p className="sub">
            Your credits are locked, not burned, while the transaction is built. They are only consumed once the
            settlement is on chain. If the transaction cannot be built or the node rejects it before broadcast, the
            credits are released back to you.
          </p>
          <p className="sub">
            If a transaction is broadcast but its result cannot be confirmed, the withdrawal is marked
            <strong> manual review</strong> and the credits stay locked. They are never refunded automatically — the
            transaction could still confirm, and refunding would pay twice.
          </p>
        </div>
      </div>

      <h2>Your withdrawals</h2>
      <div className="card scroll">
        {withdrawals.length === 0 ? <p className="sub" style={{ margin: 0 }}>No withdrawals yet.</p> : (
          <table>
            <thead><tr><th>Credits</th><th>Settles</th><th>Destination</th><th>Status</th><th>Transaction</th><th>When</th></tr></thead>
            <tbody>
              {withdrawals.map((w) => {
                const a = config.settlementAssets.find((x) => x.id === w.settlementAssetId);
                return (
                  <tr key={w.id}>
                    <td>{fmt(w.creditsUnits)}</td>
                    <td>{fmt(w.settlementUnits, a?.decimals ?? 6)} {a?.label ?? w.settlementAssetId}</td>
                    <td className="mono break">{w.destinationAddress.slice(0, 16)}…</td>
                    <td>
                      <StatusPill status={w.status} />
                      {w.failureReason ? <div className="sub">{w.failureReason}</div> : null}
                    </td>
                    <td className="mono break">
                      {w.txHash ? (
                        <a href={`${config.explorerBase}/transaction/${w.txHash}`} target="_blank" rel="noreferrer">{shortHash(w.txHash)}</a>
                      ) : "—"}
                    </td>
                    <td className="sub">{when(w.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
