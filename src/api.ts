import type {
  Deposit, FundingRoute, LedgerEntry, Rebalance, ReserveStatus, SettlementAsset, SettlementTarget, Withdrawal,
} from "./shared/types.js";

export interface Outcome {
  situation: string;
  result: string;
  credits: string;
}

export interface GatewayConfig {
  network: string;
  explorerBase: string;
  sepoliaExplorerBase: string;
  chainProvider: string;
  vaultAddress: string;
  routes: FundingRoute[];
  settlementAssets: Array<SettlementAsset & { rateBps: number }>;
  settlementTargets: SettlementTarget[];
  conversion: {
    executedByGateway: boolean;
    productionProvider: string;
    trigger: string;
    operatorAction: string;
    recorded: string[];
    statuses: string[];
    completionRule: string;
  };
  depositOutcomes: Outcome[];
  withdrawalOutcomes: Outcome[];
  exchanges: string[];
  fees: {
    withdrawalFlatUnits: number;
    withdrawalBps: number;
    depositFlatUnits: number;
    depositBps: number;
    minWithdrawalUnits: number;
    maxWithdrawalUnits: number;
  };
}

export interface Account {
  signedIn: boolean;
  email?: string;
  role?: "user" | "admin";
  balance?: { availableUnits: number; lockedUnits: number };
}

export class ApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
    body: json === undefined ? rest.body : JSON.stringify(json),
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.error ?? "Request failed.", data.code ?? "error");
  return data as T;
}

export const api = {
  config: () => request<GatewayConfig>("/api/gateway/config"),
  account: () => request<Account>("/api/account"),
  register: (email: string, password: string) => request("/api/auth/register", { method: "POST", json: { email, password } }),
  login: (email: string, password: string) => request("/api/auth/login", { method: "POST", json: { email, password } }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  adminLogin: (password: string) => request("/api/admin/login", { method: "POST", json: { password } }),

  createDeposit: (body: Record<string, unknown>) => request<Deposit>("/api/deposits", { method: "POST", json: body }),
  deposits: () => request<Deposit[]>("/api/deposits"),
  refreshDeposit: (id: string) => request<Deposit>(`/api/deposits/${id}/refresh`, { method: "POST" }),

  quote: (amount: string, settlementAssetId: string) =>
    request<{ creditsUnits: number; feeUnits: number; netCreditsUnits: number; settlementUnits: number; rateBps: number }>(
      "/api/withdrawals/quote", { method: "POST", json: { amount, settlementAssetId } },
    ),
  createWithdrawal: (body: Record<string, unknown>, requestKey: string) =>
    request<Withdrawal>("/api/withdrawals", { method: "POST", json: body, headers: { "idempotency-key": requestKey } }),
  withdrawals: () => request<Withdrawal[]>("/api/withdrawals"),

  transactions: () => request<{ deposits: Deposit[]; withdrawals: Withdrawal[]; ledger: LedgerEntry[] }>("/api/transactions"),
  reserve: () => request<ReserveStatus>("/api/reserve"),
  evidence: () => request<EvidenceResponse>("/api/evidence"),

  admin: {
    overview: () => request<any>("/api/admin/overview"),
    deposits: (status?: string) => request<Deposit[]>(`/api/admin/deposits${status ? `?status=${status}` : ""}`),
    approve: (id: string) => request<Deposit>(`/api/admin/deposits/${id}/approve`, { method: "POST" }),
    reject: (id: string, reason: string) => request<Deposit>(`/api/admin/deposits/${id}/reject`, { method: "POST", json: { reason } }),
    withdrawals: (status?: string) => request<Withdrawal[]>(`/api/admin/withdrawals${status ? `?status=${status}` : ""}`),
    settle: (id: string) => request<Withdrawal>(`/api/admin/withdrawals/${id}/settle`, { method: "POST" }),
    confirm: (id: string) => request<Withdrawal>(`/api/admin/withdrawals/${id}/confirm`, { method: "POST" }),
    release: (id: string, note: string) => request<Withdrawal>(`/api/admin/withdrawals/${id}/release`, { method: "POST", json: { note } }),
    reserve: () => request<ReserveStatus>("/api/admin/reserve"),
    integrity: () => request<any>("/api/admin/integrity"),
    rebalances: () => request<Rebalance[]>("/api/admin/rebalances"),
    createRebalance: (body: Record<string, unknown>) => request<Rebalance>("/api/admin/rebalances", { method: "POST", json: body }),
    updateRebalance: (id: string, body: Record<string, unknown>) =>
      request<Rebalance>(`/api/admin/rebalances/${id}`, { method: "PATCH", json: body }),
  },
};

export interface EvidenceResponse {
  environment: {
    network: string;
    gatewayUrl: string;
    vaultAddress: string;
    vaultExplorerUrl: string | null;
    cardanoDepositAddress: string | null;
    sepoliaDepositAddress: string | null;
    chainAccess: string;
    checkedAt: number;
  };
  depositOutcomes: Outcome[];
  withdrawalOutcomes: Outcome[];
  creditedDeposits: Array<Deposit & { account: string; explorerUrl: string | null }>;
  settledWithdrawals: Array<Withdrawal & { account: string; explorerUrl: string | null }>;
  rejectedDeposits: Array<Deposit & { account: string }>;
  refundedWithdrawals: Array<Withdrawal & { account: string }>;
  manualReviewWithdrawals: Array<Withdrawal & { account: string }>;
  duplicateSubmissions: Array<Deposit & { account: string }>;
  integrity: {
    ok: boolean;
    balancesTotalUnits: number;
    ledgerSupplyUnits: number;
    driftUnits: number;
    problems: string[];
    checkedAt: number;
  };
  reserve: ReserveStatus | null;
}

/** Display helper for integer base units. Balances never become floats server-side. */
export function fmt(units: number | null | undefined, decimals = 6): string {
  if (units === null || units === undefined) return "—";
  const negative = units < 0;
  const abs = Math.abs(Math.trunc(units));
  const whole = Math.floor(abs / 10 ** decimals).toLocaleString("en-US");
  const frac = String(abs % 10 ** decimals).padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const shortHash = (hash: string | null): string => (hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "—");

export const when = (ms: number | null | undefined): string =>
  ms ? new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
