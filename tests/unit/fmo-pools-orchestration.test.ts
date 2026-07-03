import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeManagementSessionRequest } from "../helpers/managementSession.ts";
import type { FmoHeadCandidate } from "../../src/lib/fmoPools/types.ts";
import type { FmoRebalancePlan } from "../../src/lib/fmoPools/rebalance.ts";
import type { FmoPoolSpec } from "../../src/shared/schemas/fmoPools.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-fmo-orchestration-"));
const ORIGINAL_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.INITIAL_PASSWORD = "fmo-orchestration-test-password";
process.env.OMNIROUTE_DISABLE_REDIS_AUTH_CACHE = "1";

const core = await import("../../src/lib/db/core.ts");
const combosDb = await import("../../src/lib/db/combos.ts");
const featureFlagsDb = await import("../../src/lib/db/featureFlags.ts");
const fmoPoolsDb = await import("../../src/lib/db/fmoPools.ts");
const intelligenceDb = await import("../../src/lib/db/modelIntelligence.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const { buildFmoSolveCandidates } = await import("../../src/lib/fmoPools/candidates.ts");
const { buildFmoGenerationPlan, loadIncumbencyPrior } =
  await import("../../src/lib/fmoPools/planGeneration.ts");
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

function poolPayload(comboId: string, overrides: Partial<FmoPoolSpec> = {}): FmoPoolSpec {
  return {
    pool_id: `pool-${comboId}`,
    combo_id: comboId,
    demand: { requests_per_day: 100, workload_class: "chat" },
    constraints: {
      free_only: false,
      capabilities: ["chat"],
      min_context_tokens: 32_000,
      quality_band: {
        source: "test",
        metric: "coding",
        category: "coding",
        min: 0.5,
        max: 0.9,
        relax: { max_delta: 0.1, when: "test" },
      },
    },
    tail: { strategy: "configured", mode: "fallback", compatibility: "test" },
    ...overrides,
  };
}

function acceptGeneration(comboIds: string[], generation = "gen-orchestration-1"): void {
  fmoPoolsDb.storeFmoPoolsGeneration(
    {
      contract_version: fmoPoolSchemas.FMO_POOLS_CONTRACT_VERSION,
      generation,
      rebalance: { interval_minutes: 60 },
      pools: comboIds.map((comboId) => poolPayload(comboId)),
    },
    null
  );
}

function head(overrides: Partial<FmoHeadCandidate> = {}): FmoHeadCandidate {
  return {
    providerId: "gemini",
    connectionId: "acct-1",
    connection: { id: "acct-1", provider: "gemini" },
    modelId: "gemini-2.0-flash",
    displayName: "Gemini 2.0 Flash",
    capabilities: ["chat"],
    contextWindow: 128_000,
    freeModel: null,
    source: "synced",
    ...overrides,
  };
}

function plan(comboId: string, generation = "gen-orchestration-1"): FmoRebalancePlan {
  return {
    generation,
    plans: {
      [comboId]: [
        {
          role: "head",
          providerId: "gemini",
          modelId: "gemini-2.0-flash",
          connectionId: "acct-1",
          countedCapacity: 100,
        },
      ],
    },
    decisions: [
      {
        comboId,
        providerId: "gemini",
        modelId: "gemini-2.0-flash",
        connectionId: "acct-1",
        role: "head",
        outcome: "seated",
        reason: "test",
      },
    ],
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

test("candidate assembler carries band, quota, per-pool capacity, and excludes tail providers", async () => {
  let quotaCalls = 0;
  const pools = [
    fmoPoolsDb.mapFmoPoolSpecToPlanningPool(poolPayload("combo-light")),
    fmoPoolsDb.mapFmoPoolSpecToPlanningPool(
      poolPayload("combo-reasoning", {
        demand: { requests_per_day: 100, workload_class: "reasoning" },
      })
    ),
  ];

  const candidates = await buildFmoSolveCandidates(pools, {
    inventory: {
      async getProviderConnections() {
        return [
          { id: "acct-1", provider: "gemini" },
          { id: "tail-1", provider: "tail-provider" },
        ];
      },
      async getSyncedAvailableModelsForConnection(providerId, connectionId) {
        return [
          {
            id: `${providerId}-model-${connectionId}`,
            name: `${providerId} ${connectionId}`,
            source: "imported",
            supportedEndpoints: ["chat"],
            inputTokenLimit: 128_000,
          },
        ];
      },
      getModelCompatOverrides() {
        return [];
      },
      freeModelCatalog: [
        {
          provider: "gemini",
          modelId: "gemini-model-acct-1",
          displayName: "Gemini",
          monthlyTokens: 24_000_000,
          creditTokens: 0,
          freeType: "recurring-daily",
          poolKey: null,
          tos: "caution",
        },
      ],
      readTailConfig() {
        return { providers: ["tail-provider"] };
      },
    },
    intelligence: {
      getResolvedTaskFitness() {
        return 0.7;
      },
    },
    quota: {
      async getUsageForCandidate() {
        quotaCalls += 1;
        return null;
      },
      async searchResearchClaim() {
        return null;
      },
    },
  });

  assert.equal(candidates.length, 1);
  assert.equal(quotaCalls, 1);
  assert.equal(candidates[0].providerId, "gemini");
  assert.equal(candidates[0].qualityScoreByComboId?.["combo-light"], 0.7);
  assert.equal(candidates[0].capacityPerDayByComboId?.["combo-light"], 320);
  assert.equal(candidates[0].capacityPerDayByComboId?.["combo-reasoning"], 100);
  assert.equal(candidates[0].isFree, true);
});

test("orchestrator produces solved head/tail plans and loads incumbency prior", async () => {
  const comboId = await createCombo("Orchestrated Combo");
  acceptGeneration([comboId]);
  await rebalance.rebalanceFmoPools({ planOverride: plan(comboId) });

  const built = await buildFmoGenerationPlan({
    inventory: {
      async getProviderConnections() {
        return [{ id: "acct-1", provider: "gemini" }];
      },
      async getSyncedAvailableModelsForConnection() {
        return [
          {
            id: "gemini-2.0-flash",
            name: "Gemini",
            source: "imported",
            supportedEndpoints: ["chat"],
            inputTokenLimit: 128_000,
          },
        ];
      },
      getModelCompatOverrides() {
        return [];
      },
      freeModelCatalog: [],
      readTailConfig() {
        return { providers: [] };
      },
    },
    intelligence: { getResolvedTaskFitness: () => 0.7 },
    quota: {
      async getUsageForCandidate() {
        return { requestsPerDay: 100 };
      },
      async searchResearchClaim() {
        return null;
      },
    },
    readTailConfig: () => ({
      entries: [
        {
          providerId: "tail-provider",
          modelId: "tail-model",
          capabilities: ["chat"],
          contextWindow: 128_000,
        },
      ],
    }),
  });
  const prior = loadIncumbencyPrior("gen-orchestration-1");

  assert.equal(prior.byComboId[comboId][0].providerId, "gemini");
  assert.equal(built.plans[comboId][0].role, "head");
  assert.equal(built.plans[comboId][0].providerId, "gemini");
  assert.equal(
    built.plans[comboId].some((member) => member.role === "tail"),
    true
  );
});

test("no-candidate pool materializes tail-only and logs empty-head outcome", async () => {
  const comboId = await createCombo("Tail Only Combo");
  fmoPoolsDb.storeFmoPoolsGeneration(
    {
      contract_version: fmoPoolSchemas.FMO_POOLS_CONTRACT_VERSION,
      generation: "gen-tail-only",
      rebalance: { interval_minutes: 60 },
      pools: [
        poolPayload(comboId, {
          constraints: {
            ...poolPayload(comboId).constraints,
            free_only: true,
            capabilities: ["tools"],
          },
        }),
      ],
    },
    null
  );

  const built = await buildFmoGenerationPlan({
    inventory: {
      async getProviderConnections() {
        return [head({ freeModel: null })];
      },
      async getSyncedAvailableModelsForConnection() {
        return [];
      },
      getModelCompatOverrides() {
        return [];
      },
      freeModelCatalog: [],
      readTailConfig() {
        return { providers: [] };
      },
    },
    readTailConfig: () => ({
      entries: [
        {
          providerId: "tail-tools",
          modelId: "tool",
          capabilities: ["tools"],
          contextWindow: 128_000,
        },
      ],
    }),
  });

  assert.deepEqual(
    built.plans[comboId].map((member) => member.role),
    ["tail"]
  );
  assert.ok(built.decisions.some((decision) => decision.reason === "empty-head-tail-only"));
});

test("scheduled rebalance and repeated pool publish compute plans without supplied members", async () => {
  featureFlagsDb.setFeatureFlagOverride("OMNIROUTE_FMO_POOLS_ENABLED", "true");
  await settingsDb.updateSettings({ requireLogin: true });
  const comboId = await createCombo("Route Combo");
  acceptGeneration([comboId], "gen-route");
  const connection = await providersDb.createProviderConnection({
    provider: "gemini",
    authType: "apikey",
    name: "Gemini",
    apiKey: "test-key",
    isActive: true,
  });
  await modelsDb.replaceSyncedAvailableModelsForConnection("gemini", String(connection.id), [
    {
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      source: "imported",
      supportedEndpoints: ["chat"],
      inputTokenLimit: 128_000,
    },
  ]);
  intelligenceDb.upsertModelIntelligence({
    model: "gemini-2.0-flash",
    source: "user_override",
    category: "coding",
    score: 0.7,
    eloRaw: null,
    confidence: "high",
    expiresAt: null,
  });

  const scheduler = rebalance.createFmoRebalanceScheduler({
    enabled: () => true,
    intervalMs: 1,
    run: () => rebalance.rebalanceFmoPools(),
  });
  const timer = scheduler.start();
  assert.ok(timer);
  await new Promise((resolve) => setTimeout(resolve, 25));
  clearTimeout(timer);
  scheduler.stop();
  const scheduledCombo = await combosDb.getComboById(comboId);
  assert.notEqual(scheduledCombo?.models.length, 0);

  const response = await poolsRoute.PUT(
    await makeManagementSessionRequest("http://localhost/api/fmo/pools", {
      method: "PUT",
      body: {
        contract_version: fmoPoolSchemas.FMO_POOLS_CONTRACT_VERSION,
        generation: "gen-route",
        rebalance: { interval_minutes: 60 },
        pools: [poolPayload(comboId)],
      },
    })
  );
  const body = (await response.json()) as {
    applied: boolean;
    diffs: Array<{ afterModels: unknown[] }>;
  };

  assert.equal(response.status, 202);
  assert.equal(body.applied, true);
  assert.notEqual(body.diffs[0].afterModels.length, 0);
});

test("public FMO rebalance API route is removed", () => {
  assert.equal(
    fs.existsSync(path.join(process.cwd(), "src/app/api/fmo/rebalance/route.ts")),
    false
  );
});

test("computed apply abort leaves previous generation live", async () => {
  const comboId = await createCombo("Abort Previous");
  acceptGeneration([comboId], "gen-previous");
  await rebalance.rebalanceFmoPools({ planOverride: plan(comboId, "gen-previous") });
  const before = await combosDb.getComboById(comboId);
  core.getDbInstance().prepare("UPDATE combos SET data = ? WHERE id = ?").run("{", comboId);

  await assert.rejects(() =>
    rebalance.rebalanceFmoPools({ planOverride: plan(comboId, "gen-next") })
  );

  core
    .getDbInstance()
    .prepare("UPDATE combos SET data = ? WHERE id = ?")
    .run(JSON.stringify(before), comboId);
  assert.equal(rebalance.getFmoAppliedGeneration(), "gen-previous");
});
