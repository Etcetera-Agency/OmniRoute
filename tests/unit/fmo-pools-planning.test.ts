import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FmoHeadCandidate } from "../../src/lib/fmoPools/types.ts";
import type { FmoInventoryDeps } from "../../src/lib/fmoPools/inventory.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-fmo-planning-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const { buildFmoHeadInventory } = await import("../../src/lib/fmoPools/inventory.ts");
const { resolveFmoBand } = await import("../../src/lib/fmoPools/intelligence.ts");
const {
  calculateFmoRequestCapacityPerDay,
  observeFmoTokensPerRequest,
  reloadFmoTokensPerRequestForTests,
  resetFmoTokensPerRequestForTests,
  resolveFmoTokensPerRequest,
} = await import("../../src/lib/fmoPools/capacity.ts");
const { normalizeFmoLiveQuotaAxes, resolveFmoQuota } =
  await import("../../src/lib/fmoPools/quota.ts");
const callLogs = await import("../../src/lib/usage/callLogs.ts");
const core = await import("../../src/lib/db/core.ts");

function inventoryDeps(): FmoInventoryDeps {
  return {
    async getProviderConnections() {
      return [
        { id: "acct-1", provider: "gemini", isActive: true },
        { id: "acct-2", provider: "gemini", isActive: true },
        { id: "tail-1", provider: "tail-provider", isActive: true },
      ];
    },
    async getSyncedAvailableModelsForConnection(providerId, connectionId) {
      return [
        {
          id: `${providerId}-model`,
          name: `${providerId} ${connectionId}`,
          source: "imported",
          supportedEndpoints: ["chat"],
          inputTokenLimit: 128_000,
          supportsThinking: true,
        },
      ];
    },
    getModelCompatOverrides(providerId) {
      return providerId === "gemini" ? [{ id: "gemini-model", normalizeToolCallId: true }] : [];
    },
    freeModelCatalog: [
      {
        provider: "gemini",
        modelId: "gemini-model",
        displayName: "Gemini Free",
        monthlyTokens: 25_000_000,
        creditTokens: 0,
        freeType: "recurring-daily",
        poolKey: null,
        tos: "caution",
      },
    ],
    readTailConfig() {
      return { providers: ["tail-provider"] };
    },
  };
}

function candidate(overrides: Partial<FmoHeadCandidate> = {}): FmoHeadCandidate {
  return {
    providerId: "gemini",
    connectionId: "acct-1",
    connection: { id: "acct-1", provider: "gemini" },
    modelId: "gemini-model",
    displayName: "Gemini",
    capabilities: [],
    contextWindow: 128_000,
    freeModel: null,
    source: "synced",
    ...overrides,
  };
}

test("planning inventory expands multi-account providers and excludes tail providers", async () => {
  const rows = await buildFmoHeadInventory(inventoryDeps());

  assert.deepEqual(
    rows.map((row) => row.connectionId),
    ["acct-1", "acct-2"]
  );
  assert.ok(rows.every((row) => row.providerId === "gemini"));
  assert.ok(rows.every((row) => row.contextWindow === 128_000));
  assert.ok(rows.every((row) => row.freeModel?.monthlyTokens === 25_000_000));
  assert.ok(rows.every((row) => row.capabilities.includes("tool_call")));
});

test("planning inventory emits runtime custom models for each active connection", async () => {
  const rows = await buildFmoHeadInventory({
    ...inventoryDeps(),
    async getProviderConnections() {
      return [
        { id: "acct-1", provider: "local-openai", isActive: true },
        { id: "acct-2", provider: "local-openai", isActive: true },
      ];
    },
    async getSyncedAvailableModelsForConnection() {
      return [];
    },
    async getAllCustomModels() {
      return {
        "local-openai": [
          {
            id: "local-openai/my-runtime-model",
            name: "Runtime Model",
            apiFormat: "openai",
            supportedEndpoints: ["chat"],
            inputTokenLimit: 64_000,
            supportsThinking: true,
          },
        ],
      };
    },
  });

  assert.deepEqual(
    rows.map((row) => [row.connectionId, row.modelId, row.source]),
    [
      ["acct-1", "local-openai/my-runtime-model", "custom"],
      ["acct-2", "local-openai/my-runtime-model", "custom"],
    ]
  );
  assert.ok(rows.every((row) => row.capabilities.includes("chat")));
  assert.ok(rows.every((row) => row.capabilities.includes("api:openai")));
  assert.ok(rows.every((row) => row.capabilities.includes("thinking")));
});

test("planning inventory dedupes synced and custom models by connection model key", async () => {
  const rows = await buildFmoHeadInventory({
    ...inventoryDeps(),
    async getProviderConnections() {
      return [{ id: "acct-1", provider: "openrouter", isActive: true }];
    },
    async getSyncedAvailableModelsForConnection() {
      return [
        {
          id: "openrouter/foo",
          name: "Synced Foo",
          source: "imported",
          supportedEndpoints: ["chat"],
          inputTokenLimit: 32_000,
        },
      ];
    },
    async getAllCustomModels() {
      return {
        openrouter: [
          {
            id: "openrouter/foo",
            name: "Custom Foo",
            apiFormat: "openai",
            supportedEndpoints: ["chat", "responses"],
            inputTokenLimit: 64_000,
          },
        ],
      };
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].displayName, "Synced Foo");
  assert.equal(rows[0].contextWindow, 32_000);
  assert.equal(rows[0].source, "synced");
  assert.ok(rows[0].capabilities.includes("api:openai"));
});

test("planning inventory skips hidden and malformed custom/synced models", async () => {
  const rows = await buildFmoHeadInventory({
    ...inventoryDeps(),
    async getProviderConnections() {
      return [
        { id: "acct-head", provider: "head-provider", isActive: true },
        { id: "acct-tail", provider: "tail-provider", isActive: true },
      ];
    },
    async getSyncedAvailableModelsForConnection(providerId) {
      if (providerId !== "head-provider") return [];
      return [
        {
          id: "head-provider/hidden-synced",
          name: "Hidden Synced",
          source: "imported",
          supportedEndpoints: ["chat"],
          inputTokenLimit: 32_000,
        },
        {
          id: "head-provider/visible-synced",
          name: "Visible Synced",
          source: "imported",
          supportedEndpoints: ["chat"],
          inputTokenLimit: 32_000,
        },
      ];
    },
    async getAllCustomModels() {
      return {
        "head-provider": [
          { name: "No ID" },
          {
            id: "head-provider/hidden-custom",
            name: "Hidden Custom",
            isHidden: true,
          },
          {
            id: "head-provider/visible-custom",
            name: "Visible Custom",
            supportedEndpoints: ["chat"],
            inputTokenLimit: 32_000,
          },
        ],
        "tail-provider": [
          {
            id: "tail-provider/manual-head",
            name: "Tail Manual",
            supportedEndpoints: ["chat"],
            inputTokenLimit: 32_000,
          },
        ],
      };
    },
    getModelIsHidden(providerId, modelId) {
      return providerId === "head-provider" && modelId === "head-provider/hidden-synced";
    },
    readTailConfig() {
      return { providers: ["tail-provider"] };
    },
  });

  assert.deepEqual(rows.map((row) => row.modelId).sort(), [
    "head-provider/visible-custom",
    "head-provider/visible-synced",
  ]);
});

test("band resolution accepts in-band candidates and rejects unrated candidates", () => {
  const inBand = resolveFmoBand(
    candidate(),
    { category: "coding", min: 0.55, max: 0.8, relax: 0.1 },
    { getResolvedTaskFitness: () => 0.7 }
  );
  const unrated = resolveFmoBand(
    candidate(),
    { category: "coding", min: 0.55, max: 0.8, relax: 0.1 },
    { getResolvedTaskFitness: () => null }
  );

  assert.deepEqual(inBand, { score: 0.7, inBand: true, relaxed: false, headEligible: true });
  assert.deepEqual(unrated, { score: null, inBand: false, relaxed: false, headEligible: false });
});

test("live quota adapter handles provider-wide and per-model quota shapes", () => {
  assert.deepEqual(
    normalizeFmoLiveQuotaAxes(
      { requests_per_day: 100, tokens_per_month: 1_000_000 },
      candidate({ modelId: "any-model" })
    ),
    { requestsPerDay: 100, tokensPerMonth: 1_000_000 }
  );

  assert.deepEqual(
    normalizeFmoLiveQuotaAxes(
      {
        quotas: {
          "gemini-model": { requestsPerMinute: 2, tokensPerDay: 100_000 },
        },
      },
      candidate()
    ),
    { requestsPerMinute: 2, tokensPerDay: 100_000 }
  );
});

test("static catalog quota is used without search when live quota is absent", async () => {
  let searchCalls = 0;
  const result = await resolveFmoQuota(
    candidate({ freeModel: inventoryDeps().freeModelCatalog[0] }),
    {
      getUsageForCandidate: async () => null,
      searchResearchClaim: async () => {
        searchCalls += 1;
        return null;
      },
    }
  );

  assert.equal(searchCalls, 0);
  assert.deepEqual(result, {
    tier: 2,
    axes: { tokensPerMonth: 25_000_000 },
    source: "static-catalog",
  });
});

test("capacity uses global factor when class weight is smaller", () => {
  resetFmoTokensPerRequestForTests();

  assert.equal(resolveFmoTokensPerRequest({ workload_class: "light" }), 2000);
  assert.equal(
    calculateFmoRequestCapacityPerDay({ tokensPerMonth: 6_000_000 }, { workload_class: "light" }),
    100
  );
});

test("contract workload classes resolve to dedicated weights", () => {
  resetFmoTokensPerRequestForTests();

  assert.equal(resolveFmoTokensPerRequest({ workload_class: "chat" }), 2500);
  assert.equal(resolveFmoTokensPerRequest({ workload_class: "reasoning" }), 8000);
  assert.equal(resolveFmoTokensPerRequest({ workload_class: "tools" }), 6000);
  assert.equal(resolveFmoTokensPerRequest({ workload_class: "unknown" }), 2000);
});

test("global tokens-per-request smooths, clamps, and persists across restart", () => {
  resetFmoTokensPerRequestForTests();

  assert.equal(resolveFmoTokensPerRequest({}), 2000);

  // EMA: a single sample moves the factor toward it, it does not jump to it,
  // so one outlier request cannot whipsaw every pool's capacity.
  assert.equal(observeFmoTokensPerRequest(8000, 1), 2600); // 2000*0.9 + 8000*0.1
  assert.equal(observeFmoTokensPerRequest(8000, 1), 3140); // converges gradually
  assert.equal(resolveFmoTokensPerRequest({}), 3140);

  // request-equivalents: the sample is observedTokens / observedRequests
  assert.equal(observeFmoTokensPerRequest(20_000, 2), 3826); // 3140*0.9 + 10000*0.1

  // the learned factor persists across a restart
  assert.equal(reloadFmoTokensPerRequestForTests(), 3826);

  // an extreme sample is still clamped to the ceiling
  assert.equal(observeFmoTokensPerRequest(2_000_000, 1), 128_000);

  resetFmoTokensPerRequestForTests();
  assert.equal(resolveFmoTokensPerRequest({}), 2000);
  assert.equal(reloadFmoTokensPerRequestForTests(), 2000);
});

test("request call logs observe total tokens for the global factor", async () => {
  resetFmoTokensPerRequestForTests();

  await callLogs.saveCallLog({
    tokens: { prompt_tokens: 3000, completion_tokens: 1000, total_tokens: 4000 },
    status: 200,
    provider: "gemini",
    model: "gemini-model",
    connectionId: "acct-1",
  });

  assert.equal(resolveFmoTokensPerRequest({}), 2200); // 2000*0.9 + 4000*0.1
  assert.equal(reloadFmoTokensPerRequestForTests(), 2200);
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});
