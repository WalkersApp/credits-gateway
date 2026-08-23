import type { ReactNode } from "react";
import type { DepositStatus, WithdrawalStatus } from "../shared/types.js";

const TONE: Record<string, "good" | "wait" | "warn" | "bad"> = {
  credited: "good", confirmed: "good",
  pending: "wait", confirming: "wait", processing: "wait", submitted: "wait", planned: "wait",
  manual_review: "warn", refunded: "warn", low: "warn",
  rejected: "bad", failed: "bad", critical: "bad",
  healthy: "good", completed: "good",
};

export function StatusPill({ status }: { status: DepositStatus | WithdrawalStatus | string }) {
  return <span className={`pill ${TONE[status] ?? ""}`}>{status.replace("_", " ")}</span>;
}

export function Flow({ active }: { active: "funding" | "validation" | "credits" | "settlement" | null }) {
  const steps: Array<[typeof active, string]> = [
    ["funding", "funding"],
    ["validation", "validation"],
    ["credits", "credits"],
    ["settlement", "cardano settlement"],
  ];
  return (
    <div className="flow">
      {steps.map(([id, label], i) => (
        <span key={label}>
          <span className={`step ${active === id ? "on" : ""}`}>{label}</span>
          {i < steps.length - 1 ? <span className="arrow"> → </span> : null}
        </span>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label>{label}</label>
      {children}
      {hint ? <div className="sub" style={{ marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  return <div className={`notice ${kind}`}>{children}</div>;
}
