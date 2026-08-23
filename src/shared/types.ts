// Shared between the API and the UI. Keep it descriptive rather than clever —
// the reviewer-facing pages render straight from these shapes.

export type DepositStatus =
  | "pending"      // created, nothing seen on chain / not yet reviewed
  | "confirming"   // transaction found, waiting for confirmations
  | "confirmed"    // validated, not yet credited
  | "credited"     // credits issued (terminal, happy path)
  | "rejected"     // refused by validation or by an admin (terminal)
  | "failed";      // validation could not complete (terminal)

export type WithdrawalStatus =
  | "pending"        // credits locked, waiting to be picked up
  | "processing"     // building/signing the settlement transaction
  | "submitted"      // broadcast, waiting for confirmations
  | "confirmed"      // on chain (terminal, happy path)
  | "failed"         // failed before broadcast (terminal, credits released)
  | "refunded"       // credits returned after a failure (terminal)
  | "manual_review"; // broadcast outcome unknown — never auto-refunded

export type LedgerKind = "deposit" | "withdrawal" | "refund" | "adjustment";
export type LedgerDirection = "credit" | "debit" | "lock" | "unlock" | "spend";

export type VerificationMethod = "onchain_automatic" | "manual_admin";

export interface FundingRoute {
  id: string;
  network: string;          // "ethereum-sepolia", "cardano-preprod", "cex"
  networkLabel: string;
  asset: string;            // "USDC", "ADA", "USDCx"
  assetDecimals: number;
  provider: string;         // who actually verifies / custodies at this hop
  verification: VerificationMethod;
  confirmationsRequired: number;
  depositAddress: string | null;
  contract: string | null;  // ERC-20 contract or Cardano asset unit
  enabled: boolean;
  rateBps: number;          // credits per token, 10000 = 1:1
  minUnits: number;
  notes: string;
}

export interface SettlementAsset {
  id: string;               // "tada" | "usdcx-preprod" | ...
  label: string;
  unit: string;             // "lovelace" or policyId+hexName
  decimals: number;
  official: boolean;        // true only when the issuer is confirmed for THIS network
  officialityNote: string;
  minSettlementUnits: number;
  enabled: boolean;
}

export interface CreditBalance {
  availableUnits: number;
  lockedUnits: number;
}

export interface LedgerEntry {
  id: string;
  seq: number;
  userId: string;
  direction: LedgerDirection;
  amountUnits: number;
  kind: LedgerKind;
  refType: "deposit" | "withdrawal" | "admin";
  refId: string | null;
  idempotencyKey: string;
  availableAfterUnits: number;
  lockedAfterUnits: number;
  createdAt: number;
}

export interface Deposit {
  id: string;
  userId: string;
  routeId: string;
  network: string;
  asset: string;
  status: DepositStatus;
  declaredUnits: number | null;   // what the user said they sent
  observedUnits: number | null;   // what we actually saw on chain
  creditsUnits: number | null;    // what we issued
  rateBps: number;
  feeUnits: number;
  txHash: string | null;
  reference: string | null;       // CEX withdrawal id, for manual routes
  exchange: string | null;
  confirmations: number;
  confirmationsRequired: number;
  verification: VerificationMethod;
  rejectionReason: string | null;
  /** How many times the same transaction/reference was submitted again. */
  duplicateSubmissions: number;
  createdAt: number;
  updatedAt: number;
  creditedAt: number | null;
}

export interface Withdrawal {
  id: string;
  userId: string;
  requestKey: string | null;
  status: WithdrawalStatus;
  creditsUnits: number;          // gross credits locked
  feeUnits: number;
  netCreditsUnits: number;
  settlementAssetId: string;
  settlementUnits: number;       // amount in the settlement asset's base units
  rateBps: number;
  destinationAddress: string;
  txHash: string | null;
  confirmations: number;
  failureReason: string | null;
  createdAt: number;
  updatedAt: number;
  submittedAt: number | null;
  confirmedAt: number | null;
  refundedAt: number | null;
}

export interface ReserveStatus {
  network: string;
  vaultAddress: string;
  assets: Array<{
    assetId: string;
    label: string;
    balanceUnits: number;
    lockedUnits: number;      // committed to withdrawals not yet on chain
    minUnits: number;
    targetUnits: number;
    health: "healthy" | "low" | "critical";
    official: boolean;
  }>;
  checkedAt: number;
}

export interface Rebalance {
  id: string;
  sourceNetwork: string;
  sourceAsset: string;
  sourceAmount: string;
  provider: string;
  destinationAssetId: string;
  expectedAmount: string;
  actualAmount: string | null;
  reference: string | null;
  status: "planned" | "processing" | "completed" | "failed";
  note: string;
  createdAt: number;
  updatedAt: number;
}
