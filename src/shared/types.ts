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
  // Roles are listed separately on purpose: "provider" as one word hides who
  // issues the asset, who serves the chain data and who holds the funds.
  assetIssuer: string;
  chainAccess: string;
  validation: string;
  custody: string;
  automation: "automatic" | "manual" | "not exercised";
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
  /** Thresholds in this asset's base units. */
  reserve: { criticalUnits: number; minUnits: number; targetUnits: number };
}

/** A settlement asset we intend to use in production but have not deployed. */
export interface SettlementTarget {
  label: string;
  network: string;
  status: string;
  note: string;
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

export interface ReserveAssetStatus {
  assetId: string;
  label: string;
  balanceUnits: number;
  lockedUnits: number;      // committed to withdrawals not yet on chain
  /** balance - locked: what a new withdrawal could actually draw on. */
  availableUnits: number;
  /** availableUnits expressed back in credit units at the server-side rate, so
   *  reserve capacity and credit liability can be compared in one unit. */
  capacityCreditUnits: number;
  criticalUnits: number;
  minUnits: number;
  targetUnits: number;
  /** How far below `targetUnits` the free balance sits (0 when at or above). */
  shortfallToTargetUnits: number;
  health: "healthy" | "low" | "critical";
  official: boolean;
}

/**
 * Outstanding credits are the gateway's liability: every credit issued and not
 * yet settled is a claim someone may present. Coverage compares that liability
 * against the settlement capacity actually held on chain.
 */
export interface ReserveLiability {
  /** Credits in user accounts, available + locked. */
  outstandingCreditUnits: number;
  availableCreditUnits: number;
  lockedCreditUnits: number;
  /** Total capacity across enabled settlement assets, in credit units. */
  totalCapacityCreditUnits: number;
  /** capacity - liability. Negative means the reserve cannot cover every credit. */
  surplusCreditUnits: number;
  /** Basis points of the liability covered by reserve capacity; 10000 = 100%.
   *  Null when there is no outstanding liability to cover. */
  coverageBps: number | null;
  fullyCovered: boolean;
}

export interface ReserveWarning {
  severity: "info" | "warning" | "critical";
  code:
    | "reserve_low"
    | "reserve_critical"
    | "liability_uncovered"
    | "capacity_below_max_withdrawal";
  assetId: string | null;
  message: string;
}

export interface ReserveStatus {
  network: string;
  vaultAddress: string;
  assets: ReserveAssetStatus[];
  liability: ReserveLiability;
  warnings: ReserveWarning[];
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
  /** "auto" when the gateway raised this request itself because the reserve fell
   *  below its threshold; "admin" when a person booked it. An auto request is a
   *  request for a human to act — the gateway never moves liquidity itself. */
  origin: "auto" | "admin";
  /** Set on auto requests: what the reserve looked like when it was raised. */
  trigger: {
    assetId: string;
    availableUnits: number;
    minUnits: number;
    targetUnits: number;
    health: "low" | "critical";
  } | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

/**
 * A liquidity route the gateway could one day use to convert external
 * stablecoin liquidity into a Cardano settlement asset.
 *
 * NOTHING here is integrated. Every route is declared with
 * `status: "future_integration"` and no code path can execute one — the registry
 * exists so the interface a pilot integration must satisfy is visible and typed,
 * not to imply a connection that does not exist.
 */
export interface LiquidityProviderRoute {
  id: string;
  label: string;
  sourceNetwork: string;
  sourceAsset: string;
  destinationAssetId: string;
  destinationNetwork: string;
  status: "future_integration";
  /** What would have to be true before this route could be enabled. */
  requirements: string[];
  note: string;
}
