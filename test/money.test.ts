import "./setup.js";

import assert from "node:assert/strict";
import { test } from "node:test";

import { assetUnitsToCredits, creditsToAssetUnits, feeUnits, formatUnits, parseUnits } from "../server/money.js";

test("parses decimal input into integer units", () => {
  assert.equal(parseUnits("1"), 1_000_000);
  assert.equal(parseUnits("0.000001"), 1);
  assert.equal(parseUnits("12.5"), 12_500_000);
});

test("rejects input that is not a plain positive decimal", () => {
  for (const bad of ["", "-1", "1e6", "abc", "1.2345678", " 1,5 "]) {
    assert.throws(() => parseUnits(bad), /amount|decimal/i, `expected ${bad} to be rejected`);
  }
});

test("formats units back without rounding", () => {
  assert.equal(formatUnits(1_000_000), "1");
  assert.equal(formatUnits(1_500_000), "1.5");
  assert.equal(formatUnits(1), "0.000001");
});

test("fee is flat plus bps and never exceeds the gross", () => {
  assert.equal(feeUnits(100_000_000, 250_000, 50), 250_000 + 500_000);
  assert.equal(feeUnits(1_000, 250_000, 50), 1_000);
});

test("asset conversion is integer-only in both directions", () => {
  assert.equal(assetUnitsToCredits(2_500_000, 6, 10_000), 2_500_000);
  assert.equal(assetUnitsToCredits(1_000_000_000_000_000_000, 18, 10_000), 1_000_000);
  assert.equal(creditsToAssetUnits(2_500_000, 6, 10_000), 2_500_000);
});
