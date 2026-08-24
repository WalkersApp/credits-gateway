import "./setup.js";

import assert from "node:assert/strict";
import { test } from "node:test";

import { SETTLEMENT_ASSETS, SETTLEMENT_RATE_BPS, getSettlementAsset } from "../server/settlement/assets.js";

const TUSDM_POLICY = "11c93226aabf1e9157620857d9ac013ba111680bd837f62a7ca90214";
const TUSDM_NAME_HEX = "0014df10745553444d";

test("tUSDM is registered with the policy id and asset name verified on chain", () => {
  const asset = getSettlementAsset("tusdm-preprod");
  assert.equal(asset.unit, `${TUSDM_POLICY}${TUSDM_NAME_HEX}`);
  assert.equal(asset.decimals, 6);
  assert.equal(asset.unit.slice(0, 56), TUSDM_POLICY, "policy id is the first 56 hex chars of the unit");
  assert.equal(asset.unit.slice(56), TUSDM_NAME_HEX, "asset name keeps its CIP-68 (333) label");
});

test("tUSDM is never presented as official or as production USDM", () => {
  const asset = getSettlementAsset("tusdm-preprod");
  assert.equal(asset.official, false);
  assert.match(asset.label, /test/i);
  assert.match(asset.officialityNote, /not production USDM/i);
  assert.match(asset.officialityNote, /pilot phase/i);
});

test("no settlement asset in this deployment claims to be production USDM or USDCx", () => {
  for (const asset of SETTLEMENT_ASSETS) {
    if (asset.official) {
      // Only the preprod network's own asset may be called official here.
      assert.equal(asset.id, "tada", `${asset.id} must not be marked official`);
    }
  }
});

test("the tUSDM demonstration rate is 1:1 with credits", () => {
  assert.equal(SETTLEMENT_RATE_BPS["tusdm-preprod"], 10_000);
});
