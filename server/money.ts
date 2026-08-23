// All internal balances are integer "credit units". Nothing in this codebase is
// allowed to hold a fractional balance in a float — parse once here, format once
// here, and do integer arithmetic everywhere in between.

export const CREDIT_DECIMALS = 6;
export const CREDIT_UNIT = 1_000_000; // 1 credit = 1,000,000 units

/** Largest amount we accept anywhere. Keeps every intermediate product well
 *  inside Number.MAX_SAFE_INTEGER even after fee/bps multiplication. */
export const MAX_UNITS = 1_000_000 * CREDIT_UNIT;

export class AmountError extends Error {}

/**
 * Parse a human decimal string ("12.5") into integer base units.
 * Rejects anything that isn't a plain positive decimal so we never end up
 * doing `parseFloat("1e9")` or silently truncating scientific notation.
 */
export function parseUnits(input: string | number, decimals = CREDIT_DECIMALS): number {
  const raw = String(input).trim();
  if (!/^\d{1,12}(\.\d{1,18})?$/.test(raw)) throw new AmountError("Enter a valid amount.");
  const [whole, frac = ""] = raw.split(".");
  if (frac.length > decimals) throw new AmountError(`At most ${decimals} decimal places.`);
  const units = Number(whole) * 10 ** decimals + Number((frac + "0".repeat(decimals)).slice(0, decimals) || 0);
  if (!Number.isSafeInteger(units)) throw new AmountError("Amount is too large.");
  return units;
}

/** Format integer base units back to a decimal string, no rounding. */
export function formatUnits(units: number, decimals = CREDIT_DECIMALS): string {
  const sign = units < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(units));
  const whole = Math.floor(abs / 10 ** decimals);
  const frac = String(abs % 10 ** decimals).padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

export function assertPositiveUnits(units: number, what = "amount"): void {
  if (!Number.isInteger(units) || units <= 0) throw new AmountError(`Invalid ${what}.`);
  if (units > MAX_UNITS) throw new AmountError(`The ${what} exceeds this gateway's limit.`);
}

/** Fee = flat + bps of gross, rounded down, never more than the gross. */
export function feeUnits(grossUnits: number, flatUnits: number, bps: number): number {
  const fee = Math.max(0, Math.trunc(flatUnits)) + Math.floor((grossUnits * Math.max(0, bps)) / 10_000);
  return Math.min(fee, grossUnits);
}

/**
 * Convert an amount held in one asset's base units into credit units at a
 * server-side rate expressed in basis points of 1:1 (10000 = one credit per
 * whole token). Deliberately integer-only.
 */
export function assetUnitsToCredits(amountUnits: number, assetDecimals: number, rateBps: number): number {
  const scaled = assetDecimals === CREDIT_DECIMALS
    ? amountUnits
    : assetDecimals > CREDIT_DECIMALS
      ? Math.floor(amountUnits / 10 ** (assetDecimals - CREDIT_DECIMALS))
      : amountUnits * 10 ** (CREDIT_DECIMALS - assetDecimals);
  return Math.floor((scaled * rateBps) / 10_000);
}

export function creditsToAssetUnits(creditUnits: number, assetDecimals: number, rateBps: number): number {
  const scaled = Math.floor((creditUnits * 10_000) / rateBps);
  return assetDecimals === CREDIT_DECIMALS
    ? scaled
    : assetDecimals > CREDIT_DECIMALS
      ? scaled * 10 ** (assetDecimals - CREDIT_DECIMALS)
      : Math.floor(scaled / 10 ** (CREDIT_DECIMALS - assetDecimals));
}
