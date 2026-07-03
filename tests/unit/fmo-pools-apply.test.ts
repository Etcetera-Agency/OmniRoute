import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeManagementSessionRequest } from "../helpers/managementSession.ts";
import type { FmoRebalancePlan } from "../../src/lib/fmoPools/rebalance.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-fmo-apply-"));
const ORIGINAL_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.INITIAL_PASSWORD = "fmo-apply-test-password";
process.env.OMNIROUTE_DISABLE_REDIS_AUTH_CACHE = "1";

const core = await import("../../src/lib/db/core.ts");
const combosDb = await import("../../src/lib/db/combos.ts");
const featureFlagsDb = await import("../../src/lib/db/featureFlags.ts");
const fmoPoolsDb = await import("../../src/lib/db/fmoPools.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const rebalance = await import("../../src/lib/fmoPools/rebalance.ts");
const poolsRoute = await import("../../src/app/api/fmo/pools/route.ts");
const fmoPoolSchemas = await import("../../src/shared/schemas/fmoPools.ts");

async function resetStorage(): Promise<void> {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  await settingsDb.updateSettings({ requireLogin: false });
}

async function createCombo(name: string): Promise<string> {
  const combo = await combosDb.createCombo({
    name,
    models: [{ provider: "openai", model: "gpt-4.1" }],
  });
  return String(combo.id);
}

function acceptGeneration(comboId: string, generation = "gen-apply-1"): void {
  fmoPoolsDb.storeFmoPoolsGeneration(
    {
      contract_version: fmoPoolSchemas.FMO_POOLS_CONTRACT_VERSION,
      generation,
      generated_at: new Date().toISOString(),
      rebalance: { interval_minutes: 60 },
      pools: [
        {
          pool_id: "pool-apply",
          combo_id: comboId,
          demand: { requests_per_day: 100, workload_class: "coding" },
          constraints: {
            free_only: true,
            capabilities: [],
            min_context_tokens: 128_000,
            quality_band: {
              source: "test",
              metric: "text",
              category: "default",
              min: 0.5,
              max: 0.8,
              relax: { max_delta: 0.1, when: "test" },
            },
          },
          tail: { strategy: "configured", mode: "fallback", compatibility: "test" },
        },
      ],
    },
    null
  );
}

function plan(comboIds: string[], generation = "gen-apply-1"): FmoRebalancePlan {
  return {
    generation,
    plans: Object.fromEntries(
      comboIds.map((comboId, index) => [
        comboId,
        [
          {
            role: "head",
            providerId: "gemini",
            modelId: `gemini-${index}`,
            connectionId: `acct-${index}`,
            countedCapacity: 100,
          },
          {
            role: "tail",
            providerId: "tail",
            modelId: "fallback",
            connectionId: null,
            countedCapacity: 0,
          },
        ],
      ])
    ),
    decisions: comboIds.map((comboId, index) => ({
      comboId,
      providerId: "gemini",
      modelId: `gemini-${index}`,
      connectionId: `acct-${index}`,
      role: "head",
      outcome: "seated",
      reason: "test",
    })),
  };
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

test("apply writes priority strategy and advances prior only on commit", async () => {
  const comboId = await createCombo("Apply Combo");
  const result = await rebalance.rebalanceFmoPools({ planOverride: plan([comboId]) });
  const combo = await combosDb.getComboById(comboId);

  assert.equal(result.applied, true);
  assert.equal(combo?.strategy, "priority");
  assert.equal(combo?.models[0].providerId, "gemini");
  assert.equal(combo?.models[1].providerId, "tail");
  assert.equal(rebalance.getFmoAppliedGeneration(), "gen-apply-1");
});

test("shadow mode returns diff and writes no combo row", async () => {
  const comboId = await createCombo("Shadow Combo");
  const before = await combosDb.getComboById(comboId);
  const result = await rebalance.rebalanceFmoPools({ shadow: true, planOverride: plan([comboId]) });
  const after = await combosDb.getComboById(comboId);

  assert.equal(result.applied, false);
  assert.equal(result.diffs[0].changed, true);
  assert.deepEqual(after, before);
});

test("apply is all-or-nothing when a later combo write fails", async () => {
  const ids = await Promise.all([createCombo("One"), createCombo("Two"), createCombo("Three")]);
  const before = await Promise.all(ids.map((id) => combosDb.getComboById(id)));
  core.getDbInstance().prepare("UPDATE combos SET data = ? WHERE id = ?").run("{", ids[2]);

  await assert.rejects(() => rebalance.rebalanceFmoPools({ planOverride: plan(ids) }));

  const afterOne = await combosDb.getComboById(ids[0]);
  const afterTwo = await combosDb.getComboById(ids[1]);
  assert.deepEqual(afterOne, before[0]);
  assert.deepEqual(afterTwo, before[1]);
  assert.equal(rebalance.getFmoAppliedGeneration(), null);
});

test("scheduler is gated by feature flag callback", () => {
  const disabled = rebalance.createFmoRebalanceScheduler({ enabled: () => false }).start();
  assert.equal(disabled, null);
});

test("scheduler cadence comes from latest accepted pool generation", async () => {
  const comboId = await createCombo("Cadence Combo");

  assert.equal(rebalance.createFmoRebalanceScheduler({ enabled: () => true }).start(), null);

  acceptGeneration(comboId, "gen-cadence-1");
  assert.equal(rebalance.getFmoRebalanceIntervalMs(), 60 * 60 * 1000);

  fmoPoolsDb.storeFmoPoolsGeneration(
    {
      contract_version: fmoPoolSchemas.FMO_POOLS_CONTRACT_VERSION,
      generation: "gen-cadence-2",
      generated_at: new Date().toISOString(),
      rebalance: { interval_minutes: 15 },
      pools: [
        {
          pool_id: "pool-cadence",
          combo_id: comboId,
          demand: { requests_per_day: 100, workload_class: "coding" },
          constraints: {
            free_only: true,
            capabilities: [],
            min_context_tokens: 128_000,
            quality_band: {
              source: "test",
              metric: "text",
              category: "default",
              min: 0.5,
              max: 0.8,
              relax: { max_delta: 0.1, when: "test" },
            },
          },
          tail: { strategy: "configured", mode: "fallback", compatibility: "test" },
        },
      ],
    },
    null
  );

  assert.equal(rebalance.getFmoRebalanceIntervalMs(), 15 * 60 * 1000);
});

test("scheduler reuses startup timer shape and reschedules after publish", async () => {
  let intervalMs = 1;
  let runCount = 0;
  const scheduler = rebalance.createFmoRebalanceScheduler({
    enabled: () => true,
    intervalMs: () => intervalMs,
    run: () => {
      runCount += 1;
    },
  });

  const timer = scheduler.start();
  assert.ok(timer);
  intervalMs = 5;
  const rescheduled = scheduler.reschedule();
  assert.ok(rescheduled);
  await new Promise((resolve) => setTimeout(resolve, 8));
  scheduler.stop();

  assert.ok(runCount >= 1);
});

test("pool publish rejects unauthenticated calls and applies authenticated plan", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  await settingsDb.updateSettings({ requireLogin: true });
  const comboId = await createCombo("Manual Combo");
  const payload = {
    contract_version: fmoPoolSchemas.FMO_POOLS_CONTRACT_VERSION,
    generation: "gen-publish-apply",
    rebalance: { interval_minutes: 30 },
    pools: [
      {
        pool_id: "pool-publish",
        combo_id: comboId,
        demand: { requests_per_day: 100, workload_class: "coding" },
        constraints: {
          free_only: false,
          capabilities: [],
          min_context_tokens: 128_000,
          quality_band: {
            source: "test",
            metric: "text",
            category: "default",
            min: 0.5,
            max: 0.8,
            relax: { max_delta: 0.1, when: "test" },
          },
        },
        tail: { strategy: "configured", mode: "fallback", compatibility: "test" },
      },
    ],
  };

  const rejected = await poolsRoute.PUT(
    new Request("http://localhost/api/fmo/pools", {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    })
  );
  assert.equal(rejected.status, 401);

  const accepted = await poolsRoute.PUT(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "PUT",
      body: payload,
    })
  );
  const combo = await combosDb.getComboById(comboId);
  const body = (await accepted.json()) as { applied?: boolean; generation?: string };

  assert.equal(accepted.status, 202);
  assert.equal(body.applied, true);
  assert.equal(body.generation, "gen-publish-apply");
  assert.equal(combo?.strategy, "priority");
});
