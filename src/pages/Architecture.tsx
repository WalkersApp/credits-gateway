import { useEffect, useState } from "react";

import { api, fmt, type GatewayConfig } from "../api.js";
import type { ReserveStatus } from "../shared/types.js";

export function Architecture({ config }: { config: GatewayConfig }) {
  const [reserve, setReserve] = useState<ReserveStatus | null>(null);
  useEffect(() => { api.reserve().then(setReserve).catch(() => undefined); }, []);

  const network = config.network.replace("cardano-", "");
  const credits = (units: number) => `${fmt(units)} credits`;

  return (
    <>
      <h1>Technical architecture</h1>
      <p className="lede">
        How external stablecoin value becomes WFIT credits, and how credits are settled back out on Cardano {network}.
      </p>

      <h2>What this is, and what it is not</h2>
      <div className="card">
        <div className="diagram">
          <div className="node">External stablecoin / exchange withdrawal</div>
          <div className="down">↓</div>
          <div className="node">Validated deposit — the gateway reads the source chain</div>
          <div className="down">↓</div>
          <div className="node accent">WFIT credits (off-chain accounting layer)</div>
          <div className="down">↓</div>
          <div className="node">Settlement liquidity process — <strong>operator-run, outside this system</strong>, recorded here</div>
          <div className="down">↓</div>
          <div className="node">Cardano settlement reserve (WFIT-operated custodial vault)</div>
          <div className="down">↓</div>
          <div className="node">Settlement asset — <strong>USDM / USDCx in production</strong>, tADA in this preprod deployment</div>
          <div className="down">↓</div>
          <div className="node">User withdrawal to a user-controlled Cardano address</div>
        </div>
        <ul className="plain">
          <li>WFIT is <strong>not</strong> building a new blockchain bridge. Value moves between chains through
            existing, external routes; this gateway validates and accounts for it.</li>
          <li>WFIT credits are an <strong>off-chain accounting layer</strong>. Not a token, not a stablecoin,
            not transferable between users.</li>
          <li>Credits are issued <strong>only after a deposit has been validated on its source chain</strong>,
            from the amount that actually arrived — never from the amount a user typed.</li>
          <li>Source-chain deposit custody and Cardano settlement liquidity are <strong>separate
            responsibilities</strong> with separate addresses and separate accounting.</li>
          <li>The settlement liquidity step is <strong>not automated</strong>. No bridge, no DEX call, no
            market maker: an operator converts liquidity through an external route and books it, and the
            gateway verifies the result against the vault's on-chain balance.</li>
          <li>This is a <strong>standalone financial infrastructure layer</strong>, reusable by any
            application that needs it. It is <strong>not integrated into any production application</strong>
            — separate codebase, database, process, domain and signing key — and it does not read or write
            another product's data.</li>
          <li>Production settlement targets are <strong>USDM and USDCx on Cardano</strong>.</li>
          <li>This preprod deployment validates the <strong>settlement engine and the accounting and failure
            controls around it</strong>. It is not a finished mainnet gateway, and we do not present it as one.</li>
        </ul>
      </div>

      <h2>Catalyst pilot scope</h2>
      <div className="card">
        <p className="sub" style={{ marginTop: 0 }}>
          <strong>Demonstrated by this deployment.</strong> Deposit validation against the source chain ·
          credit accounting with an append-only ledger and a conservation check · the Cardano settlement flow
          end to end · reserve protection with per-asset thresholds · failure handling including refunds and
          held-for-review submits · operational visibility through this page and the evidence page.
        </p>
        <p className="sub">
          <strong>Not demonstrated yet.</strong> Production USDM settlement · production USDCx settlement ·
          automated liquidity conversion or rebalancing · exchange API integration. These are pilot work, and
          no page in this deployment presents them as done.
        </p>
      </div>

      <h2>Funding routes and who does what</h2>
      <p className="sub">
        "Provider" on its own hides too much, so each role is listed separately. The asset issuer is not the
        chain-data provider, and neither of them holds the funds.
      </p>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Route</th><th>Asset issuer</th><th>Chain access</th><th>Validation</th>
              <th>Custody</th><th>Automation</th><th>State</th>
            </tr>
          </thead>
          <tbody>
            {config.routes.map((r) => (
              <tr key={r.id}>
                <td>{r.networkLabel}<br /><span className="sub">{r.asset}</span></td>
                <td className="sub">{r.assetIssuer}</td>
                <td className="sub">{r.chainAccess}</td>
                <td className="sub">{r.validation}{r.confirmationsRequired ? ` · ${r.confirmationsRequired} confirmations` : ""}</td>
                <td className="sub">{r.custody}</td>
                <td>
                  <span className={`pill ${r.automation === "automatic" ? "good" : r.automation === "manual" ? "warn" : "wait"}`}>
                    {r.automation}
                  </span>
                </td>
                <td><span className={`pill ${r.enabled ? "good" : "wait"}`}>{r.enabled ? "enabled" : "off"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub">
        <strong>Automation</strong> means what has actually run here. <em>automatic</em> — validated on chain and
        exercised end to end on this deployment. <em>manual</em> — an admin approves it; no exchange API is
        integrated. <em>not exercised</em> — the validation code exists and is enabled, but no deposit has been
        credited through it on this deployment.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>These are deposit routes only</h3>
        <p className="sub" style={{ marginTop: 0 }}>{config.settlementDirection.depositRoutes}</p>
        <p className="sub"><strong>{config.settlementDirection.withdrawalDestinations}</strong></p>
        <p className="sub">{config.settlementDirection.rule}</p>
        <div className="diagram">
          <div className="node">Ethereum Sepolia · Cardano preprod · exchange withdrawal</div>
          <div className="down">↓ deposit, inbound only</div>
          <div className="node accent">WFIT credits ledger</div>
          <div className="down">↓ withdrawal, Cardano only</div>
          <div className="node">USDM / USDCx on Cardano in production — tADA on this preprod deployment</div>
        </div>
      </div>

      <h2>Cardano settlement</h2>
      <div className="card">
        <dl className="kv">
          <dt>Submission</dt>
          <dd>Blockfrost preprod. Transactions are built, balanced and signed inside the gateway process; the
            provider only reads UTxOs and broadcasts.</dd>
          <dt>Confirmation / read</dt>
          <dd>Koios preprod first, Blockfrost as a fallback. Two independent indexers, so one outage cannot
            strand a settled withdrawal in an unknown state.</dd>
          <dt>Custody</dt>
          <dd className="break">
            WFIT-operated Cardano settlement vault: {reserve?.vaultAddress ?? config.vaultAddress}
          </dd>
          <dt>Signing</dt>
          <dd>The key is held server-side, outside the repository, mode 600, read once by the gateway process.
            It is never logged, never returned by an API and never reaches the browser.</dd>
        </dl>
      </div>

      <h2>Settlement assets</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Asset</th><th>Rate</th><th>Status</th><th>Basis</th></tr></thead>
          <tbody>
            {config.settlementAssets.map((a) => (
              <tr key={a.id}>
                <td>{a.label}{a.enabled ? "" : <><br /><span className="sub">disabled</span></>}</td>
                <td>{a.rateBps / 10_000} per credit</td>
                <td><span className={`pill ${a.official ? "good" : "warn"}`}>{a.official ? "network asset" : "test asset — not issuer-confirmed"}</span></td>
                <td className="sub">{a.officialityNote}</td>
              </tr>
            ))}
            {config.settlementTargets.map((s) => (
              <tr key={s.label}>
                <td>{s.label}<br /><span className="sub">{s.network}</span></td>
                <td className="sub">—</td>
                <td><span className="pill wait">{s.status}</span></td>
                <td className="sub">{s.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <p className="sub" style={{ marginTop: 0 }}>
          <strong>What the preprod tADA settlement proves:</strong> coin selection, transaction construction,
          signing, submission, confirmation, the withdrawal state transition and the credits reconciliation that
          follows it — the settlement engine itself, exercised against a real chain.
        </p>
        <p className="sub">
          <strong>What it does not prove:</strong> that USDM or USDCx payouts have been validated. No USDM or
          USDCx payout has been made by this deployment. tADA is the preprod network asset; it demonstrates the
          settlement mechanism, not stablecoin peg behaviour.
        </p>
        <p className="sub">
          <strong>Registered, enabled and exercised are three different things.</strong> Registered means the
          settlement-asset registry knows the asset; enabled means this deployment will select it for a
          payout; exercised means a transaction exists. Only tADA is all three. USDM and USDCx are{" "}
          <strong>registered production targets — not enabled, not exercised</strong>, and they sit at the
          same level of support: they differ in how the reserve would be sourced, not in how the gateway
          settles them. Nothing here ranks one above the other.
        </p>
        <p className="sub">
          <strong>Four different USDCx references, four different states.</strong> The preprod USDCx{" "}
          <em>deposit route</em> is enabled but has not been exercised here. The preprod USDCx{" "}
          <em>settlement asset</em> is registered but disabled by default — a preprod registry entry, not an
          issuer-confirmed asset. USDCx on <em>Cardano mainnet</em> is a registered production target, neither
          enabled nor exercised. USDCx reached via <em>Circle xReserve</em> is a candidate reserve-funding
          route identified by research — not integrated, and no relationship with the provider exists.
        </p>
      </div>

      <h2>Custody</h2>
      <div className="card">
        <p className="sub" style={{ marginTop: 0 }}>
          <strong>{config.custody.summary.statement}</strong>
        </p>
        <p className="sub">
          User-controlled: {config.custody.summary.userControlled}. WFIT-controlled:{" "}
          {config.custody.summary.wfitControlled}. {config.custody.summary.productionNote}
        </p>
      </div>
      <div className="card scroll">
        <table>
          <thead><tr><th>Stage</th><th>What it holds</th><th>Controlled by</th><th>Model</th></tr></thead>
          <tbody>
            {config.custody.chain.map((hop) => (
              <tr key={hop.stage}>
                <td>{hop.stage}</td>
                <td className="sub">{hop.holds}</td>
                <td className="sub break">{hop.controlledBy}</td>
                <td>
                  <span className={`pill ${hop.model === "user-controlled" ? "good" : hop.model === "accounting only" ? "wait" : "warn"}`}>
                    {hop.model}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sub">
          Read top to bottom this is the custody chain: user wallet → deposit address → credits ledger →
          treasury / rebalancing layer → Cardano settlement vault → user Cardano wallet. Everything between the
          first and last row is custodial.
        </p>
      </div>
      <div className="card">
        <dl className="kv">
          {config.custody.chain.map((hop) => (
            <span key={hop.stage} style={{ display: "contents" }}>
              <dt>{hop.stage}</dt>
              <dd className="sub">{hop.note}</dd>
            </span>
          ))}
        </dl>
      </div>
      <div className="card">
        <dl className="kv">
          <dt>Source-chain deposits</dt>
          <dd>
            Held at WFIT-controlled deposit addresses, one per source chain. Custodial. The exchange route has no
            gateway-controlled address at all — funds land in a WFIT treasury account at the exchange and an admin
            books them in.
          </dd>
          <dt>Credits</dt>
          <dd>
            Database accounting only. Not a token, not a stablecoin, not a bridge asset, not transferable between
            users. Credits leave the system only through a settlement transaction.
          </dd>
          <dt>Cardano settlement reserve</dt>
          <dd className="break">
            A dedicated WFIT-operated Cardano vault — {reserve?.vaultAddress ?? config.vaultAddress}, public and
            checkable. A custodial hot wallet: there is no smart-contract vault and no multi-signature scheme in
            this implementation, and we do not describe it as non-custodial. The production vault and its key
            policy are to be declared separately before mainnet.
          </dd>
        </dl>
      </div>

      <h2>Reserve thresholds</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Settlement asset</th><th>Critical</th><th>Minimum</th><th>Target</th><th>Free now</th><th>State</th></tr></thead>
          <tbody>
            {(reserve?.assets ?? []).map((a) => (
              <tr key={a.assetId}>
                <td>{a.label}</td>
                <td className="sub">{fmt(a.criticalUnits)}</td>
                <td className="sub">{fmt(a.minUnits)}</td>
                <td className="sub">{fmt(a.targetUnits)}</td>
                <td>{fmt(a.balanceUnits - a.lockedUnits)}</td>
                <td><span className={`pill ${a.health === "healthy" ? "good" : a.health === "low" ? "warn" : "bad"}`}>{a.health}</span></td>
              </tr>
            ))}
            {!reserve ? <tr><td colSpan={6} className="sub">Reserve unavailable.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Condition</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td>free ≥ target</td><td>healthy</td></tr>
            <tr><td>minimum ≤ free &lt; target</td><td>healthy-low — monitor</td></tr>
            <tr><td>critical ≤ free &lt; minimum</td><td>low — rebalance required</td></tr>
            <tr><td>free &lt; critical</td><td>critical — rebalance urgently</td></tr>
            <tr><td>free &lt; the requested settlement</td><td>that settlement is blocked before any credits are locked</td></tr>
          </tbody>
        </table>
        <p className="sub">
          Thresholds are configured per settlement asset, in that asset's base units. "Free" is the on-chain
          balance minus everything already committed to withdrawals that have not yet settled.
        </p>
      </div>

      <h2>Liquidity and rebalancing</h2>
      <div className="card">
        <p className="sub" style={{ marginTop: 0 }}>
          <strong>This gateway does not execute conversions.</strong> It does not run a bridge, a DEX
          integration or a market maker, and it does not claim to. Conversion happens outside the system; the
          gateway defines the interface, records what happened, and verifies the result against the chain.
        </p>
        <p className="sub">
          <strong>Today:</strong> reserve tracking read from the chain, rebalance records, and manual treasury
          operations. <strong>Pilot work:</strong> selecting and contracting the treasury route, completing any
          issuer onboarding, and automating what can be automated — reserve-triggered rebalance records,
          on-chain verification of the resulting mint transaction, swap quote and slippage pre-checks with
          policy-bounded signing, and reverse-leg monitoring.
        </p>
        <p className="sub">
          <strong>Candidate routes — none integrated.</strong> Normalisation through an exchange or an issuer
          fiat account, then Cardano entry through Circle's xReserve minting USDCx to a WFIT-controlled
          address, then — where USDM is required — either an on-chain swap from USDCx on a Cardano DEX or
          direct issuance by the USDM issuer (Moneta, or NBX in the EEA). <strong>No account, agreement,
          onboarding or API access exists with any party named, and none has been contacted.</strong> These
          were identified by desk research: identification is not integration, and this page states them
          separately. Regulatory descriptions are the providers' own statements about themselves; we report
          them, we do not certify them.
        </p>
        <dl className="kv">
          <dt>Trigger</dt>
          <dd>{config.conversion.trigger}</dd>
          <dt>Operator action</dt>
          <dd>{config.conversion.operatorAction}</dd>
          <dt>Production conversion provider</dt>
          <dd><span className="pill wait">{config.conversion.productionProvider}</span></dd>
          <dt>Recorded for every rebalance</dt>
          <dd className="sub">{config.conversion.recorded.join(" · ")}</dd>
          <dt>Status</dt>
          <dd className="sub">{config.conversion.statuses.join(" → ")}</dd>
          <dt>Completion rule</dt>
          <dd>{config.conversion.completionRule}</dd>
        </dl>
      </div>

      <h2>How a deposit becomes a settled payout</h2>
      <div className="card">
        <p className="sub" style={{ marginTop: 0 }}>
          <strong>Worked example — {config.conversionExample.headline}.</strong> Amounts use this deployment's
          configured fees.
        </p>
        <ol>
          {config.conversionExample.steps.map((step, i) => <li key={i} className="sub">{step}</li>)}
        </ol>
        <p className="sub">
          <strong>What this does not mean.</strong> {config.conversionExample.notConverted}
        </p>
      </div>

      <h2>Fees</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Fee</th><th>Charged by</th><th>Current preprod setting</th></tr></thead>
          <tbody>
            <tr>
              <td>Source-chain / provider / exchange network fee</td>
              <td>the source chain or the exchange</td>
              <td className="sub">outside the gateway — the gateway credits only what actually arrived, after those fees</td>
            </tr>
            <tr>
              <td>Deposit fee</td>
              <td>WFIT gateway</td>
              <td>{config.fees.depositFlatUnits === 0 && config.fees.depositBps === 0
                ? "none"
                : `${credits(config.fees.depositFlatUnits)} + ${config.fees.depositBps / 100}%`}</td>
            </tr>
            <tr>
              <td>Credits conversion basis</td>
              <td>—</td>
              <td className="sub">1 credit = 1 USD of validated deposit value, before fees. Preprod tADA is credited
                1:1 for readability; that is a test rate, not a price.</td>
            </tr>
            <tr>
              <td>Withdrawal fee</td>
              <td>WFIT gateway</td>
              <td>{credits(config.fees.withdrawalFlatUnits)} + {config.fees.withdrawalBps / 100}%</td>
            </tr>
            <tr>
              <td>Cardano network fee</td>
              <td>the Cardano network</td>
              <td className="sub">paid by the settlement vault, not deducted from the user's amount. The user
                receives exactly the quoted settlement amount.</td>
            </tr>
          </tbody>
        </table>
        <p className="sub">
          Fees are <strong>preprod demonstration configuration</strong>, not a committed production price. Every
          rate and fee is computed server-side; a rate sent by a browser is ignored. Before confirming, the user
          is shown the credits used, the rate, the gateway fee and the amount they will receive.
        </p>
      </div>

      <h2>Lifecycle states</h2>
      <p className="sub">
        The happy path end to end: a deposit goes <code>pending → confirming → confirmed → credited</code>, and
        the withdrawal it funds goes <code>pending → processing → submitted → confirmed</code>. Every other state
        below is a branch off that path, and each row says where a record can go next.
      </p>
      <div className="card">
        <div className="diagram">
          <div className="node">Deposit submitted — <strong>pending</strong></div>
          <div className="down">↓ seen on chain</div>
          <div className="node">Waiting for confirmations — <strong>confirming</strong></div>
          <div className="down">↓ confirmation target met</div>
          <div className="node">Validated — <strong>confirmed</strong></div>
          <div className="down">↓ credits issued once, from the observed amount</div>
          <div className="node accent">Credits in the ledger — <strong>credited</strong></div>
          <div className="down">↓ user requests a withdrawal, credits locked</div>
          <div className="node">Withdrawal requested — <strong>pending → processing</strong></div>
          <div className="down">↓ built, signed, broadcast</div>
          <div className="node">On the network — <strong>submitted</strong></div>
          <div className="down">↓ seen on chain, locked credits consumed</div>
          <div className="node accent">Settled — <strong>confirmed</strong></div>
        </div>
        <p className="sub">
          Branches off this path: a deposit that fails validation ends <code>rejected</code> or{" "}
          <code>failed</code> with zero credits; a withdrawal that fails before broadcast ends{" "}
          <code>failed</code> and then <code>refunded</code>; a withdrawal whose submit outcome cannot be proven
          is held in <code>manual_review</code> with its credits still locked.
        </p>
      </div>
      <div className="card scroll">
        <table>
          <thead><tr><th>Deposit state</th><th>Meaning</th><th>Can move to</th></tr></thead>
          <tbody>
            {config.depositLifecycle.map((l) => (
              <tr key={l.state}>
                <td><span className="pill">{l.state}</span></td>
                <td className="sub">{l.meaning}</td>
                <td className="sub">{l.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card scroll">
        <table>
          <thead><tr><th>Withdrawal state</th><th>Meaning</th><th>Can move to</th></tr></thead>
          <tbody>
            {config.withdrawalLifecycle.map((l) => (
              <tr key={l.state}>
                <td><span className="pill">{l.state.replace("_", " ")}</span></td>
                <td className="sub">{l.meaning}</td>
                <td className="sub">{l.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <dl className="kv">
          <dt>Refunding credits</dt><dd className="sub">{config.refundPolicy.credits}</dd>
          <dt>Refunding deposits</dt><dd className="sub">{config.refundPolicy.deposits}</dd>
          <dt>Unproven settlements</dt><dd className="sub">{config.refundPolicy.unproven}</dd>
        </dl>
      </div>

      <h2>Deposit outcomes</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Situation</th><th>Result</th><th>Credits</th></tr></thead>
          <tbody>
            {config.depositOutcomes.map((o) => (
              <tr key={o.situation}><td>{o.situation}</td><td className="sub">{o.result}</td><td>{o.credits}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Withdrawal outcomes</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Situation</th><th>Result</th><th>Credits</th></tr></thead>
          <tbody>
            {config.withdrawalOutcomes.map((o) => (
              <tr key={o.situation}><td>{o.situation}</td><td className="sub">{o.result}</td><td>{o.credits}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <p className="sub" style={{ marginTop: 0 }}>
          <strong>The rule that prevents double payment.</strong> Everything that can fail — building,
          balancing, coin selection, signing, and a rejection on the <em>first</em> submit — happens before the
          transaction is broadcast, so those cases release the user's credits safely. Once a submit has been
          attempted and the outcome cannot be proven, the withdrawal goes to <code>manual_review</code> with the
          credits still locked. It is never refunded automatically, because the transaction may still confirm.
          A rejection on a <em>resubmit</em> proves nothing: if our transaction was applied, its inputs are
          already spent and the node rejects the duplicate.
        </p>
      </div>

      <h2>Technology readiness</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          The Stablecoin Gateway integration is positioned at <strong>TRL 5</strong> because its core integrated
          components have been validated in a relevant environment: real on-chain deposit verification, idempotent
          credits issuance, accounting integrity controls, reserve checks, withdrawal orchestration, failure
          handling and real Cardano preprod settlement have been exercised end to end.
        </p>
        <p className="sub">
          The pilot extends this validated integration into production USDM/USDCx settlement liquidity, declared
          production conversion and interoperability routes, and the broader WFIT ecosystem.
        </p>
        <dl className="kv">
          <dt>Existing WFIT ecosystem</dt>
          <dd>Production-proven product, running independently of this gateway.</dd>
          <dt>This stablecoin gateway</dt>
          <dd>A validated integration in preprod. See <a href="/evidence">the evidence page</a> for the records
            and transaction hashes behind that claim.</dd>
          <dt>Pilot</dt>
          <dd>Mainnet deployment, production integration and adoption.</dd>
        </dl>
      </div>
    </>
  );
}
