import assert from "node:assert/strict";
import { test } from "node:test";

import { isApiBridgeAllowedPath } from "../../src/lib/apiBridgeServer.ts";

test("API bridge allows FMO read-only management fixtures routes", () => {
  const allowed = [
    "/api/monitoring/health",
    "/api/providers",
    "/api/providers/conn-1/models",
    "/api/providers/conn-1/models?excludeHidden=true",
    "/api/v1/providers/openai/models",
    "/api/free-models",
    "/api/free-provider-rankings?category=coding",
    "/api/free-tier/summary?excludeTosAvoid=1",
    "/api/rate-limits",
    "/api/usage/analytics?period=session",
    "/api/usage/quota",
  ];

  for (const pathname of allowed) {
    assert.equal(isApiBridgeAllowedPath("GET", pathname), true, pathname);
  }
});

test("API bridge keeps OpenAI-compatible routes available", () => {
  assert.equal(isApiBridgeAllowedPath("POST", "/v1/search"), true);
  assert.equal(isApiBridgeAllowedPath("POST", "/v1/chat/completions"), true);
  assert.equal(isApiBridgeAllowedPath("GET", "/models"), true);
});

test("API bridge does not expose management writes on the API port", () => {
  assert.equal(isApiBridgeAllowedPath("POST", "/api/providers"), false);
  assert.equal(isApiBridgeAllowedPath("PATCH", "/api/providers"), false);
  assert.equal(isApiBridgeAllowedPath("POST", "/api/rate-limits"), false);
  assert.equal(isApiBridgeAllowedPath("DELETE", "/api/providers/conn-1"), false);
});

test("API bridge rejects unrelated dashboard management routes", () => {
  assert.equal(isApiBridgeAllowedPath("GET", "/api/settings"), false);
  assert.equal(isApiBridgeAllowedPath("GET", "/api/providers/conn-1/test"), false);
  assert.equal(isApiBridgeAllowedPath("GET", "/dashboard/providers"), false);
});
