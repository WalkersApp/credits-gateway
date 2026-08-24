import "./setup.js";

import assert from "node:assert/strict";
import { test } from "node:test";

import { GatewayError } from "../server/errors.js";
import {
  PROVIDER_INTEGRATION_STATUS, executeRoute, listLiquidityRoutes,
} from "../server/providers/registry.js";

test("every declared liquidity route is marked as a future integration", () => {
  const routes = listLiquidityRoutes();
  assert.ok(routes.length > 0);
  for (const route of routes) {
    assert.equal(route.status, "future_integration", `${route.id} must not claim to be integrated`);
    assert.ok(route.requirements.length > 0, `${route.id} must state what integration would require`);
  }
});

test("no provider is integrated and none has ever executed a conversion", () => {
  assert.deepEqual(PROVIDER_INTEGRATION_STATUS.integratedProviders, []);
  assert.equal(PROVIDER_INTEGRATION_STATUS.executedConversions, 0);
});

test("attempting to execute a declared route fails loudly instead of pretending", () => {
  assert.throws(
    () => executeRoute("circle-usdc"),
    (err: unknown) => err instanceof GatewayError && err.code === "provider_not_integrated",
  );
  assert.throws(() => executeRoute("nope"), GatewayError);
});
