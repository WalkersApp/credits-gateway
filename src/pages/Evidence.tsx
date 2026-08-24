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

  // The reviewer question is "does one deposit trace to one settlement", so pair
  // a credited deposit with a settled withdrawal on the same account rather than
  // asking them to join the tables below by eye.
  const settled = data.settledWithdrawals.find((w) =>
    data.creditedDeposits.some((d) => d.account === w.account && d.txHash),
  );
  const trace = settled
    ? { withdrawal: settled, deposit: data.creditedDeposits.find((d) => d.account === settled.account && d.txHash)! }
    : null;

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
        the network setting refuses anything but preprod and preview. The settlement assets exercised below are
        tADA and a preprod <strong>tUSDM test asset</strong> — a preprod automated settlement demonstration
        using test liquidity. Both evidence the settlement mechanism, not stablecoin peg behaviour and not an
        issuer relationship.
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

      <h2>2 · End to end, as one chain</h2>
      <div className="card">
        {trace ? (
          <>
            <div className="diagram">
              <div className="node">
                Deposit of {fmt(trace.deposit.observedUnits ?? 0)} {trace.deposit.asset} observed on{" "}
                {trace.deposit.network} — {txLink(trace.deposit.txHash, trace.deposit.explorerUrl)}
              </div>
              <div className="down">↓ validated at {trace.deposit.confirmations}/{trace.deposit.confirmationsRequired} confirmations</div>
              <div className="node accent">{fmt(trace.deposit.creditsUnits ?? 0)} credits issued to {trace.deposit.account}</div>
              <div className="down">↓ {fmt(trace.withdrawal.creditsUnits)} credits redeemed, {fmt(trace.withdrawal.feeUnits)} fee</div>
              <div className="node">Withdrawal locked and settled to {shortHash(trace.withdrawal.destinationAddress)}</div>
              <div className="down">↓ confirmed on chain, locked credits consumed</div>
              <div className="node accent">
                {fmt(trace.withdrawal.settlementUnits)} {trace.withdrawal.settlementAssetId} settled —{" "}
                {txLink(trace.withdrawal.txHash, trace.withdrawal.explorerUrl)}
              </div>
            </div>
            <p className="sub">
              One account, one deposit, one settlement. Both hashes resolve in a public Cardano {network}{" "}
              explorer without access to this deployment. The settlement asset here is tADA: this evidences the
              settlement mechanism, not a USDM or USDCx payout and not peg behaviour.
            </p>
          </>
        ) : (
          <p className="sub" style={{ marginTop: 0 }}>
            No single account on this deployment currently has both a credited deposit and a settled withdrawal
            to chain together. The individual records are in the tables below.
          </p>
        )}
      </div>

      <h2>3 · What you can test on this deployment</h2>
      <div className="card">
        <ol>
          <li className="sub">
            Open <a href={env.gatewayUrl} target="_blank" rel="noreferrer">{env.gatewayUrl}</a> and register an
            account. No invitation is needed and no real value is involved — this is Cardano {network}.
          </li>
          <li className="sub">
            Get preprod tADA from the{" "}
            <a href="https://docs.cardano.org/cardano-testnets/tools/faucet" target="_blank" rel="noreferrer">
              Cardano testnet faucet
            </a>{" "}
            into your own preprod wallet.
          </li>
          <li className="sub">
            Send some of it to the gateway deposit address <span className="mono break">{env.cardanoDepositAddress ?? "not configured"}</span>,
            then paste the transaction hash into <strong>Fund credits</strong>. Deliberately type a wrong amount:
            the gateway credits what it observed on chain, not what you typed.
          </li>
          <li className="sub">
            Watch the deposit move <code>pending → confirming → credited</code>. Submit the same hash a second
            time — you get the original record back and the duplicate counter increments, not a second issuance.
          </li>
          <li className="sub">
            Request a withdrawal to your own preprod address on <strong>Withdraw</strong>. The quote — credits
            used, fee, amount received — is computed server-side; a rate sent by the browser is ignored.
          </li>
          <li className="sub">
            Take the resulting transaction hash to a public Cardano {network} explorer and confirm the payout
            landed at your address, then check that your credit balance dropped by exactly the credits used.
          </li>
          <li className="sub">
            Try the failure paths: a hash that pays a different address, an amount below the route minimum, a
            withdrawal larger than your balance, or a malformed destination. Each is refused with a reason and
            without moving credits.
          </li>
        </ol>
        <p className="sub">
          <strong>What you cannot test here, because it does not exist yet:</strong> a USDM or USDCx payout, an
          automated conversion route, or an exchange API. Those are pilot work and no page in this deployment
          presents them as done.
        </p>
      </div>

      <h2>4 · Deposits that issued credits</h2>
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

      <h2>5 · Duplicate protection</h2>
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

      <h2>6 · Rejected deposits</h2>
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

      <h2>7 · Settled withdrawals</h2>
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

      <h2>8 · Reserve safety</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Asset</th><th>On chain</th><th>Committed</th><th>Free</th><th>Critical</th><th>Minimum</th><th>Target</th><th>State</th></tr></thead>
          <tbody>
            {(data.reserve?.assets ?? []).map((a) => (
              <tr key={a.assetId}>
                <td>{a.label}</td>
                <td>{fmt(a.balanceUnits)}</td>
                <td className="sub">{fmt(a.lockedUnits)}</td>
                <td>{fmt(a.availableUnits)}</td>
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

      <h2>9 · Credit liability against settlement capacity</h2>
      <div className="card">
        {data.reserve ? (
          <>
            <dl className="kv">
              <dt>Outstanding credits</dt>
              <dd>
                {fmt(data.reserve.liability.outstandingCreditUnits)}
                <span className="sub"> ({fmt(data.reserve.liability.availableCreditUnits)} available,
                  {" "}{fmt(data.reserve.liability.lockedCreditUnits)} locked in settlements)</span>
              </dd>
              <dt>Settlement capacity</dt>
              <dd>{fmt(data.reserve.liability.totalCapacityCreditUnits)} <span className="sub">credit-equivalent, free on chain</span></dd>
              <dt>Surplus</dt><dd>{fmt(data.reserve.liability.surplusCreditUnits)}</dd>
              <dt>Coverage</dt>
              <dd>
                {data.reserve.liability.coverageBps === null
                  ? <span className="sub">no outstanding credits to cover</span>
                  : <span className={`pill ${data.reserve.liability.fullyCovered ? "good" : "bad"}`}>
                      {(data.reserve.liability.coverageBps / 100).toFixed(1)}%
                    </span>}
              </dd>
            </dl>
            <p className="sub">
              Liability is read from the credit ledger; capacity is read from the vault's balance on chain. The two
              are measured independently on purpose — no operator entry, and no rebalance record, can make the
              gateway look solvent. Capacity is stated in credit-equivalent units at this deployment's settlement
              rate so the two figures are comparable.
            </p>
            {data.reserve.warnings.length > 0 ? (
              <ul className="plain">
                {data.reserve.warnings.map((w, i) => (
                  <li key={i}>
                    <span className={`pill ${w.severity === "critical" ? "bad" : w.severity === "warning" ? "warn" : ""}`}>
                      {w.severity}
                    </span>{" "}
                    {w.message}
                  </li>
                ))}
              </ul>
            ) : <p className="sub">No reserve warnings are active.</p>}
          </>
        ) : <p className="sub">Reserve unavailable.</p>}
      </div>

      <h2>10 · Accounting integrity</h2>
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

      <h2>11 · Withdrawals held or returned</h2>
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

      <h2>12 · Lifecycle and refunds</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Deposit state</th><th>Meaning</th><th>Can move to</th></tr></thead>
          <tbody>
            {data.depositLifecycle.map((l) => (
              <tr key={l.state}><td><StatusPill status={l.state} /></td><td className="sub">{l.meaning}</td><td className="sub">{l.next}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card scroll">
        <table>
          <thead><tr><th>Withdrawal state</th><th>Meaning</th><th>Can move to</th></tr></thead>
          <tbody>
            {data.withdrawalLifecycle.map((l) => (
              <tr key={l.state}><td><StatusPill status={l.state} /></td><td className="sub">{l.meaning}</td><td className="sub">{l.next}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <dl className="kv">
          <dt>Refunding credits</dt><dd className="sub">{data.refundPolicy.credits}</dd>
          <dt>Refunding deposits</dt><dd className="sub">{data.refundPolicy.deposits}</dd>
          <dt>Unproven settlements</dt><dd className="sub">{data.refundPolicy.unproven}</dd>
          <dt>Withdrawal destinations</dt><dd className="sub">{data.settlementDirection.withdrawalDestinations}</dd>
        </dl>
      </div>

      <h2>13 · Failure behaviour</h2>
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

      <h2>14 · Liquidity routes — declared, not integrated</h2>
      <div className="card scroll">
        <p className="sub">{data.providerIntegrationStatus.statement}</p>
        <table>
          <thead><tr><th>Route</th><th>Source</th><th>Destination</th><th>Status</th><th>Would require</th></tr></thead>
          <tbody>
            {data.liquidityRoutes.map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td className="sub">{r.sourceAsset} on {r.sourceNetwork}</td>
                <td className="sub">{r.destinationAssetId} on {r.destinationNetwork}</td>
                <td><span className="pill warn">future integration</span></td>
                <td className="sub">{r.requirements.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sub">
          These are named so the interface a pilot integration must satisfy is visible. Naming a provider is not
          integrating one: there are no credentials, no API calls and no executed conversions in this codebase, and
          the code path that would run one raises <span className="mono">provider_not_integrated</span> by design.
          Conversions counted so far: {data.providerIntegrationStatus.executedConversions}.
        </p>
      </div>

      <h2>15 · What this does and does not establish</h2>
      <div className="card">
        <ul className="plain">
          <li><strong>Established:</strong> on-chain deposit verification, idempotent credits issuance, accounting
            integrity, reserve checks, withdrawal orchestration, failure handling, and real Cardano {network}
            settlement — exercised end to end on this deployment.</li>
          <li><strong>Not established:</strong> production USDM or USDCx payouts. None has been made here. The
            assets exercised are tADA and a preprod <strong>tUSDM test asset</strong> whose on-chain metadata is
            self-asserted and which is absent from the Cardano Foundation preprod token registry — test
            liquidity, not production USDM, and no issuer relationship exists. Production USDM/USDCx settlement
            depends on final liquidity, treasury and provider setup during the pilot phase.</li>
          <li><strong>Reproducible:</strong> the whole path above can be re-run on demand with
            <span className="mono"> npm run demo:settlement</span>, which drives this deployment's own HTTP API —
            on-chain deposit, validation, credits, withdrawal, vault signature, settlement, confirmation — and then
            verifies the resulting transaction against Koios independently of the gateway. It exits non-zero if the
            settlement does not confirm, so it cannot report a success it did not achieve.</li>
          <li><strong>Framework only:</strong> reserve thresholds are monitored and a low reserve raises a
            rebalance <em>request</em> for a treasury operator. The gateway never moves liquidity itself, and
            marking a rebalance complete grants no settlement capacity — capacity is always re-read from the chain.</li>
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
