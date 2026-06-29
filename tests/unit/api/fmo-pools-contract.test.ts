import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeManagementSessionRequest } from "../../helpers/managementSession.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-fmo-pools-"));
const ORIGINAL_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.OMNIROUTE_DISABLE_REDIS_AUTH_CACHE = "1";
process.env.INITIAL_PASSWORD = "fmo-pools-test-password";

const core = await import("../../../src/lib/db/core.ts");
const combosDb = await import("../../../src/lib/db/combos.ts");
const featureFlagsDb = await import("../../../src/lib/db/featureFlags.ts");
const fmoPoolsDb = await import("../../../src/lib/db/fmoPools.ts");
const settingsDb = await import("../../../src/lib/db/settings.ts");
const poolsRoute = await import("../../../src/app/api/fmo/pools/route.ts");
const usageRoute = await import("../../../src/app/api/fmo/usage/route.ts");

async function resetStorage(): Promise<void> {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  await settingsDb.updateSettings({ requireLogin: false });
}

function makePayload(comboId: string): Record<string, unknown> {
  return {
    contract: "fmo-pools/v1",
    generation: "gen-001",
    generated_at: "2026-06-29T00:00:00.000Z",
    pools: [
      {
        pool_id: "coding",
        combo_id: comboId,
        demand: { requests_per_day: 100 },
        constraints: {
          min_context_tokens: 32_000,
          quality_band: { category: "coding", min: 80, max: 100, relax: 5 },
          required_capabilities: ["tools"],
          hard_gates: ["json"],
        },
        tail: [{ provider: "fallback", model: "fallback/free" }],
      },
    ],
  };
}

async function createComboId(): Promise<string> {
  const combo = await combosDb.createCombo({
    name: "FMO Pool Combo",
    models: [{ provider: "openai", model: "gpt-4.1" }],
  });
  return String(combo.id);
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  if (ORIGINAL_INITIAL_PASSWORD === undefined) delete process.env.INITIAL_PASSWORD;
  else process.env.INITIAL_PASSWORD = ORIGINAL_INITIAL_PASSWORD;
});

test("flag-off pool write is inert and does not read or store combos", async () => {
  const response = await poolsRoute.PUT(
    new Request("http://localhost/api/fmo/pools", {
      method: "PUT",
      body: JSON.stringify(makePayload("missing-combo")),
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "gen-001",
      },
    })
  );

  assert.equal(response.status, 404);
  assert.equal(fmoPoolsDb.getFmoPoolGenerationMarker(), null);
});

test("unauthenticated writes and usage reads are rejected when flag is on", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  await settingsDb.updateSettings({ requireLogin: true });

  const writeResponse = await poolsRoute.PUT(
    new Request("http://localhost/api/fmo/pools", {
      method: "PUT",
      body: JSON.stringify(makePayload("combo")),
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "gen-001",
      },
    })
  );
  const usageResponse = await usageRoute.GET(new Request("http://localhost/api/fmo/usage"));

  assert.equal(writeResponse.status, 401);
  assert.equal(usageResponse.status, 401);
  assert.equal(fmoPoolsDb.getFmoPoolGenerationMarker(), null);
});

test("valid generation is accepted and exposed through usage backchannel", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  const comboId = await createComboId();

  const response = await poolsRoute.PUT(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "PUT",
      headers: { "Idempotency-Key": "gen-001" },
      body: makePayload(comboId),
    })
  );

  assert.equal(response.status, 202);
  assert.equal((await response.json()).status, "accepted");
  assert.equal((await combosDb.getComboById(comboId))?.strategy, "priority");

  const usageResponse = await usageRoute.GET(
    await makeManagementSessionRequest("http://localhost/api/fmo/usage")
  );
  const usageBody = (await usageResponse.json()) as {
    marker: { generation: string; poolCount: number };
    pools: Array<{ poolId: string; comboId: string; status: string }>;
  };

  assert.equal(usageResponse.status, 200);
  assert.equal(usageBody.marker.generation, "gen-001");
  assert.equal(usageBody.marker.poolCount, 1);
  assert.deepEqual(usageBody.pools, [
    { poolId: "coding", comboId, generation: "gen-001", status: "accepted" },
  ]);
});

test("unknown shape and missing min_context_tokens are rejected with sanitized errors", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  const comboId = await createComboId();
  const payload = makePayload(comboId);
  const [pool] = payload.pools as Array<Record<string, unknown>>;
  const constraints = pool.constraints as Record<string, unknown>;
  delete constraints.min_context_tokens;
  payload.extra = { should: "fail" };

  const response = await poolsRoute.PUT(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "PUT",
      headers: { "Idempotency-Key": "gen-001" },
      body: payload,
    })
  );
  const body = (await response.json()) as { error: string };

  assert.equal(response.status, 400);
  assert.equal(body.error, "Invalid fmo-pools/v1 payload");
  assert.equal(body.error.includes("min_context_tokens"), false);
  assert.equal(fmoPoolsDb.getFmoPoolGenerationMarker(), null);
});

test("missing combo fails the whole generation", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");

  const response = await poolsRoute.POST(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "POST",
      headers: { "Idempotency-Key": "gen-001" },
      body: makePayload("missing-combo"),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(fmoPoolsDb.listFmoPoolSpecs(), []);
  assert.equal(fmoPoolsDb.getFmoPoolGenerationMarker(), null);
});
