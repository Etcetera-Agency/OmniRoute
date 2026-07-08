import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const statusRoute = await import("../../../src/app/api/fmo/status/route.ts");
const usageRoute = await import("../../../src/app/api/fmo/usage/route.ts");
const fmoPoolsSchemas = await import("../../../src/shared/schemas/fmoPools.ts");
const GOLDEN_FIXTURE_PATH = path.join(process.cwd(), "tests/fixtures/fmo/fmo-pools-v1.golden.json");
const FMO_FIXTURE_PATH = path.join(
  process.cwd(),
  "../free-model-orchestrator-for-omniroute/reference/fixtures/fmo-pools-v1-generation.json"
);

async function resetStorage(): Promise<void> {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  await settingsDb.updateSettings({ requireLogin: false });
}

function fixturePayload(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(GOLDEN_FIXTURE_PATH, "utf8")) as Record<string, unknown>;
}

function replaceFixtureComboId(value: unknown, comboId: string): unknown {
  if (typeof value === "string") return value === "combo-fast" ? comboId : value;
  if (Array.isArray(value)) return value.map((item) => replaceFixtureComboId(item, comboId));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, replaceFixtureComboId(entry, comboId)])
  );
}

function makePayload(comboId: string): Record<string, unknown> {
  return replaceFixtureComboId(fixturePayload(), comboId) as Record<string, unknown>;
}

function payloadHash(payload: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
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

test("shared golden fixture conforms to the fmo-pools schema byte-for-byte", () => {
  const fixtureBytes = fs.readFileSync(GOLDEN_FIXTURE_PATH, "utf8");
  const parsed = fmoPoolsSchemas.fmoPoolsGenerationSchema.safeParse(JSON.parse(fixtureBytes));

  assert.equal(parsed.success, true);
  assert.equal(
    fixtureBytes,
    fs.readFileSync(FMO_FIXTURE_PATH, "utf8"),
    "OmniRoute and FMO fixture copies must stay byte-identical"
  );
  if (!parsed.success) return;
  assert.equal(parsed.data.pools[0]?.demand.consumers, 4);
});

test("pool demand accepts numeric consumers and fractional requests_per_day without coercion", () => {
  const payload = fixturePayload();
  const [pool] = payload.pools as Array<Record<string, unknown>>;
  const demand = pool.demand as Record<string, unknown>;
  demand.requests_per_day = 1000.5;
  demand.consumers = 4;

  const accepted = fmoPoolsSchemas.fmoPoolsGenerationSchema.safeParse(payload);
  assert.equal(accepted.success, true);
  if (!accepted.success) return;
  assert.equal(accepted.data.pools[0]?.demand.requests_per_day, 1000.5);
  assert.equal(accepted.data.pools[0]?.demand.consumers, 4);

  demand.consumers = ["hermes"];
  assert.equal(fmoPoolsSchemas.fmoPoolsGenerationSchema.safeParse(payload).success, false);
});

test("flag-off pool write is inert and does not read or store combos", async () => {
  const payload = makePayload("missing-combo");
  const response = await poolsRoute.PUT(
    new Request("http://localhost/api/fmo/pools", {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": payloadHash(payload),
      },
    })
  );

  assert.equal(response.status, 404);
  assert.equal(fmoPoolsDb.getFmoPoolGenerationMarker(), null);
});

test("unauthenticated writes and usage reads are rejected when flag is on", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  await settingsDb.updateSettings({ requireLogin: true });
  const payload = makePayload("combo");

  const writeResponse = await poolsRoute.PUT(
    new Request("http://localhost/api/fmo/pools", {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": payloadHash(payload),
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
  const payload = makePayload(comboId);

  const response = await poolsRoute.PUT(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "PUT",
      headers: { "Idempotency-Key": payloadHash(payload) },
      body: payload,
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
    { poolId: "pool-fast", comboId, generation: "gen-001", status: "accepted" },
  ]);
});

test("canonical fixture maps into planning pool without losing contract-owned fields", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  const comboId = await createComboId();
  const payload = makePayload(comboId);
  const idempotencyKey = payloadHash(payload);

  const response = await poolsRoute.PUT(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "PUT",
      headers: { "Idempotency-Key": idempotencyKey },
      body: payload,
    })
  );
  const marker = fmoPoolsDb.getFmoPoolGenerationMarker();
  const [planningPool] = fmoPoolsDb.listFmoPlanningPools();

  assert.equal(response.status, 202);
  assert.equal(marker?.idempotencyKey, idempotencyKey);
  assert.equal(marker?.contract, "fmo-pools/v1");
  assert.equal(planningPool.workload_class, "reasoning");
  assert.equal(marker?.rebalanceIntervalMinutes, 60);
  assert.equal(planningPool.demand.consumers, 4);
  assert.deepEqual(planningPool.constraints.required_capabilities, [
    "api:openai",
    "chat",
    "thinking",
    "tool_call",
  ]);
  assert.equal(planningPool.constraints.free_only, true);
  assert.deepEqual(planningPool.constraints.hard_gates, ["free_only"]);
  assert.equal(planningPool.constraints.quality_band.relax, 12);
  assert.deepEqual(planningPool.tail, {
    strategy: "auto",
    mode: "fallback",
    compatibility: "strict",
  });
});

test("rebalance interval is required and must be a positive integer", () => {
  const payload = fixturePayload();

  delete payload.rebalance;
  assert.equal(fmoPoolsSchemas.fmoPoolsGenerationSchema.safeParse(payload).success, false);

  payload.rebalance = { interval_minutes: 0 };
  assert.equal(fmoPoolsSchemas.fmoPoolsGenerationSchema.safeParse(payload).success, false);

  payload.rebalance = { interval_minutes: 15.5 };
  assert.equal(fmoPoolsSchemas.fmoPoolsGenerationSchema.safeParse(payload).success, false);

  payload.rebalance = { interval_minutes: 15 };
  assert.equal(fmoPoolsSchemas.fmoPoolsGenerationSchema.safeParse(payload).success, true);
});

test("unknown quality category is rejected at schema validation", () => {
  const payload = fixturePayload();
  const [pool] = payload.pools as Array<Record<string, unknown>>;
  const constraints = pool.constraints as Record<string, unknown>;
  const qualityBand = constraints.quality_band as Record<string, unknown>;

  qualityBand.category = "intelligence";
  assert.equal(fmoPoolsSchemas.fmoPoolsGenerationSchema.safeParse(payload).success, false);

  qualityBand.category = "default";
  assert.equal(fmoPoolsSchemas.fmoPoolsGenerationSchema.safeParse(payload).success, true);
});

test("idempotency is keyed by payload hash rather than generation", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  const comboId = await createComboId();
  const payload = makePayload(comboId);
  const idempotencyKey = payloadHash(payload);

  assert.notEqual(idempotencyKey, payload.generation);

  const first = await poolsRoute.POST(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: payload,
    })
  );
  const second = await poolsRoute.POST(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: payload,
    })
  );

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(fmoPoolsDb.getFmoPoolGenerationMarker()?.idempotencyKey, idempotencyKey);
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
      headers: { "Idempotency-Key": payloadHash(payload) },
      body: payload,
    })
  );
  const body = (await response.json()) as { error: string };

  assert.equal(response.status, 400);
  assert.equal(body.error, "Invalid fmo-pools/v1 payload");
  assert.equal(body.error.includes("min_context_tokens"), false);
  assert.equal(fmoPoolsDb.getFmoPoolGenerationMarker(), null);
});

test("tail members in the contract are rejected", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  const comboId = await createComboId();
  const payload = makePayload(comboId);
  const [pool] = payload.pools as Array<Record<string, unknown>>;
  pool.tail = [{ provider: "fallback", model: "fallback/free" }];

  const response = await poolsRoute.PUT(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "PUT",
      headers: { "Idempotency-Key": payloadHash(payload) },
      body: payload,
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(fmoPoolsDb.listFmoPoolSpecs(), []);
});

test("missing combo fails the whole generation", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  const payload = makePayload("missing-combo");

  const response = await poolsRoute.POST(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "POST",
      headers: { "Idempotency-Key": payloadHash(payload) },
      body: payload,
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(fmoPoolsDb.listFmoPoolSpecs(), []);
  assert.equal(fmoPoolsDb.getFmoPoolGenerationMarker(), null);
});

test("status endpoint exposes read-only execution diagnostics and is not required for publish", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  const comboId = await createComboId();
  const payload = makePayload(comboId);

  const publishResponse = await poolsRoute.PUT(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "PUT",
      headers: { "Idempotency-Key": payloadHash(payload) },
      body: payload,
    })
  );
  const before = fmoPoolsDb.getFmoPoolGenerationMarker();

  const statusResponse = await statusRoute.GET(
    await makeManagementSessionRequest("http://localhost/api/fmo/status")
  );
  const statusBody = (await statusResponse.json()) as {
    kind: string;
    demandFeedback: boolean;
    acceptedGeneration: { generation: string };
    appliedGeneration: string | null;
    decisionSummary: Array<unknown>;
  };
  const after = fmoPoolsDb.getFmoPoolGenerationMarker();

  assert.equal(publishResponse.status, 202);
  assert.equal(statusResponse.status, 200);
  assert.equal(statusBody.kind, "fmo_pool_execution_status");
  assert.equal(statusBody.demandFeedback, false);
  assert.equal(statusBody.acceptedGeneration.generation, "gen-001");
  assert.equal(statusBody.appliedGeneration, "gen-001");
  assert.deepEqual(after, before);
});
