import "dotenv/config";

function str(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function int(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? Math.trunc(v) : fallback;
}

function bool(name: string, fallback = false): boolean {
  const v = str(name).toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes";
}

const network = str("CARDANO_NETWORK", "preprod").toLowerCase();
if (network !== "preprod" && network !== "preview") {
  // This gateway is a preprod reference implementation. Refusing mainnet here is
  // deliberate: no configuration mistake should be able to point the settlement
  // signer at real funds.
  throw new Error(`CARDANO_NETWORK must be preprod or preview (got "${network}")`);
}

export const config = {
  env: str("NODE_ENV", "development"),
  port: int("PORT", 4523),
  publicUrl: str("PUBLIC_URL", "http://localhost:4523"),

  mongoUri: str("MONGODB_URI", "mongodb://127.0.0.1:27019"),
  mongoDb: str("MONGODB_DB", "wfit_gateway_preprod"),

  sessionSecret: str("SESSION_SECRET"),
  adminPassword: str("ADMIN_PASSWORD"),

  cardano: {
    network: network as "preprod" | "preview",
    koiosUrl: str("KOIOS_URL", `https://${network}.koios.rest/api/v1`),
    koiosToken: str("KOIOS_TOKEN"),
    blockfrostProjectId: str("BLOCKFROST_PROJECT_ID"),
    blockfrostUrl: str("BLOCKFROST_URL", `https://cardano-${network}.blockfrost.io/api/v0`),
    signingKeyPath: str("SETTLEMENT_KEY_PATH", "/root/.wfit-gateway/settlement.preprod.key"),
    vaultAddress: str("SETTLEMENT_VAULT_ADDRESS"),
    explorerBase: str("EXPLORER_BASE", `https://${network}.cardanoscan.io`),
    confirmationsRequired: int("SETTLEMENT_CONFIRMATIONS", 1),
  },

  // Cardano deposit route (tADA / preprod native assets sent to the gateway).
  cardanoDeposits: {
    enabled: bool("CARDANO_DEPOSITS_ENABLED", true),
    address: str("CARDANO_DEPOSIT_ADDRESS"),
    confirmations: int("CARDANO_DEPOSIT_CONFIRMATIONS", 3),
  },

  // Ethereum Sepolia USDC route. Circle's testnet USDC, verified on chain.
  sepolia: {
    enabled: bool("SEPOLIA_ENABLED", true),
    rpcUrl: str("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
    usdcContract: str("SEPOLIA_USDC_CONTRACT", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"),
    depositAddress: str("SEPOLIA_DEPOSIT_ADDRESS"),
    confirmations: int("SEPOLIA_CONFIRMATIONS", 3),
    explorerBase: str("SEPOLIA_EXPLORER_BASE", "https://sepolia.etherscan.io"),
  },

  cexDeposits: {
    enabled: bool("CEX_DEPOSITS_ENABLED", true),
    exchanges: str("CEX_EXCHANGES", "Binance,Bybit,Kraken,Coinbase").split(",").map((s) => s.trim()).filter(Boolean),
  },

  fees: {
    depositFlatUnits: int("DEPOSIT_FEE_FLAT_UNITS", 0),
    depositBps: int("DEPOSIT_FEE_BPS", 0),
    withdrawalFlatUnits: int("WITHDRAWAL_FEE_FLAT_UNITS", 250_000), // 0.25 credits
    withdrawalBps: int("WITHDRAWAL_FEE_BPS", 50),                   // 0.50%
    minWithdrawalUnits: int("MIN_WITHDRAWAL_UNITS", 1_000_000),
    maxWithdrawalUnits: int("MAX_WITHDRAWAL_UNITS", 500_000_000),
  },

  reserve: {
    // Defaults for every settlement asset, in that asset's base units. Override
    // one asset with RESERVE_<ASSET_ID>_MIN_UNITS etc — see settlement/assets.ts.
    minUnits: int("RESERVE_MIN_UNITS", 10_000_000),     // 10 ADA / 10 USDCx
    targetUnits: int("RESERVE_TARGET_UNITS", 100_000_000),
    criticalUnits: int("RESERVE_CRITICAL_UNITS", 3_000_000),
  },

  jobs: {
    enabled: bool("BACKGROUND_JOBS", true),
    intervalMs: int("JOB_INTERVAL_MS", 20_000),
  },
} as const;

/** Fail fast on the two secrets that must never fall back to a default. */
export function assertSecrets(): void {
  if (config.sessionSecret.length < 24) throw new Error("SESSION_SECRET must be set (24+ chars).");
  if (config.adminPassword.length < 12) throw new Error("ADMIN_PASSWORD must be set (12+ chars).");
}

export const isProd = config.env === "production";
