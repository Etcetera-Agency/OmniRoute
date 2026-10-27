import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, it, vi } from "vitest";

const previousEnv = {
  dataDir: process.env.DATA_DIR,
  bandsEnabled: process.env.OMNIROUTE_AUTO_BANDS,
  bandsConfig: process.env.OMNIROUTE_AUTO_BANDS_CONFIG,
  fullPoolFallback: process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL,
  aaApiKey: process.env.AA_API_KEY,
};
const testDataDir = mkdtempSync(path.join(tmpdir(), "omniroute-auto-bands-quality-e2e-"));
process.env.DATA_DIR = testDataDir;
process.env.OMNIROUTE_AUTO_BANDS = "1";
delete process.env.OMNIROUTE_AUTO_BANDS_CONFIG;
delete process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL;

const [
  { createVirtualAutoComboFromPrepared, resetEmptyAutoPoolWarnStateForTests },
  { setUserFitnessOverride, getTaskFitnessWithSource },
  { saveModelsDevCapabilities },
  { getResolvedModelCapabilities },
  { getDbInstance, resetDbInstance },
  { getBandConfig, getBandRange, setCalibratedBandRanges },
  { classifyTier, clearTierCache, setTierPricingSnapshot },
  providersDb,
  modelsDb,
  benchmarkSearch,
] = await Promise.all([
  import("../../../open-sse/services/autoCombo/virtualFactory"),
  import("../../../open-sse/services/autoCombo/taskFitness"),
  import("../../../src/lib/modelsDevSync"),
  import("../../../src/lib/modelCapabilities"),
  import("../../../src/lib/db/core"),
  import("../../../open-sse/services/autoCombo/bands/config"),
  import("../../../open-sse/services/tierResolver"),
  import("../../../src/lib/db/providers"),
  import("../../../src/lib/db/models"),
  import("../../../src/lib/modelBenchmarkSearch"),
]);

function resetStorage(): void {
  resetDbInstance();
  rmSync(testDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(testDataDir, { recursive: true });
}

function makeCandidate(provider: string, model: string, index: number) {
  return {
    provider,
    connectionId: `band-quality-e2e-${index}`,
    model,
    modelStr: `${provider}/${model}`,
    costPer1MTokens: 1,
  };
}

function buildCapability(tool_call: boolean) {
  return {
    tool_call,
    reasoning: false,
    attachment: null,
    structured_output: null,
    temperature: null,
    modalities_input: JSON.stringify(["text"]),
    modalities_output: JSON.stringify(["text"]),
    knowledge_cutoff: null,
    release_date: null,
    last_updated: null,
    status: null,
    family: null,
    open_weights: null,
    limit_context: null,
    limit_input: null,
    limit_output: null,
    interleaved_field: null,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", date: "Mon, 26 Oct 2026 00:00:00 GMT" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function getReturnedModelIds(
  combo: Awaited<ReturnType<typeof createVirtualAutoComboFromPrepared>>
) {
  return combo.models.map((model) => model.model);
}

beforeEach(() => {
  resetStorage();
  vi.unstubAllGlobals();
  if (previousEnv.aaApiKey === undefined) delete process.env.AA_API_KEY;
  else process.env.AA_API_KEY = previousEnv.aaApiKey;
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  delete process.env.OMNIROUTE_AUTO_BANDS_CONFIG;
  delete process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL;
  setCalibratedBandRanges(null);
  setTierPricingSnapshot(null);
  clearTierCache();
  resetEmptyAutoPoolWarnStateForTests();
});

afterAll(() => {
  vi.unstubAllGlobals();
  setTierPricingSnapshot(null);
  clearTierCache();
  resetDbInstance();
  rmSync(testDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (previousEnv.dataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousEnv.dataDir;
  if (previousEnv.bandsEnabled === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = previousEnv.bandsEnabled;
  if (previousEnv.bandsConfig === undefined) delete process.env.OMNIROUTE_AUTO_BANDS_CONFIG;
  else process.env.OMNIROUTE_AUTO_BANDS_CONFIG = previousEnv.bandsConfig;
  if (previousEnv.fullPoolFallback === undefined) {
    delete process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL;
  } else {
    process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL = previousEnv.fullPoolFallback;
  }
  if (previousEnv.aaApiKey === undefined) delete process.env.AA_API_KEY;
  else process.env.AA_API_KEY = previousEnv.aaApiKey;
});

describe("auto quality-band candidate-pool integration", () => {
  it("routes raw NVIDIA catalog IDs through benchmark high profiles in free tool bands", async () => {
    process.env.AA_API_KEY = "bands-quality-e2e-test-key";
    const rawModelId = "z-ai/glm-5.3";
    const peerModelId = "z-ai/glm-5.2";
    const connection = await providersDb.createProviderConnection({
      provider: "nvidia",
      authType: "apikey",
      name: "bands-quality-e2e-nvidia",
      apiKey: "bands-quality-e2e-test-key",
      isActive: true,
      testStatus: "active",
      providerSpecificData: {},
    });
    await modelsDb.replaceSyncedAvailableModelsForConnection("nvidia", connection.id, [
      { id: rawModelId, name: "GLM 5.3" },
      { id: peerModelId, name: "GLM 5.2" },
    ]);
    saveModelsDevCapabilities({
      nvidia: {
        [rawModelId]: buildCapability(true),
        [peerModelId]: buildCapability(true),
      },
    });
    setTierPricingSnapshot({
      nvidia: {
        [rawModelId]: { input: 0, output: 0 },
        [peerModelId]: { input: 0, output: 0 },
      },
    });
    clearTierCache();

    const terminalPackages = new Set<string>();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
        return jsonResponse({
          intelligence_index_version: 4.1,
          pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
          data: [
            {
              slug: rawModelId,
              name: "GLM 5.3 (high)",
              release_date: "2026-10-01",
              evaluations: {
                artificial_analysis_coding_index: 100,
                artificial_analysis_intelligence_index: 100,
              },
            },
            {
              slug: peerModelId,
              name: "GLM 5.2 (high)",
              release_date: "2026-10-01",
              evaluations: {
                artificial_analysis_coding_index: 1,
                artificial_analysis_intelligence_index: 1,
              },
            },
          ],
        });
      }
      if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
        return jsonResponse({
          leaderboards: [
            {
              name: "Verified",
              results: [
                { model_display: "GLM 5.3", resolved: 100 },
                { model_display: "GLM 5.2", resolved: 1 },
              ],
            },
          ],
        });
      }
      if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
        const packageName = JSON.parse(String(init?.body)).package;
        terminalPackages.add(packageName);
        assert.ok(
          packageName === "terminal-bench/terminal-bench-2" ||
            packageName === "terminal-bench/terminal-bench-2-1"
        );
        return jsonResponse({
          rows: [
            {
              metadata: {
                model_id: rawModelId,
                model_display: "GLM 5.3",
                reasoning_effort: "high",
              },
              metrics: { accuracy: 1 },
            },
            {
              metadata: {
                model_id: peerModelId,
                model_display: "GLM 5.2",
                reasoning_effort: "high",
              },
              metrics: { accuracy: 0 },
            },
          ],
        });
      }
      if (url.includes("deepswe.datacurve.ai")) {
        return jsonResponse({
          rows: [
            { model: rawModelId, reasoning_effort: "high", pass_rate: 1 },
            { model: peerModelId, reasoning_effort: "high", pass_rate: 0 },
          ],
        });
      }
      throw new Error(`Unexpected benchmark source request: ${url}`);
    });

    const refresh = await benchmarkSearch.refreshModelBenchmarkCatalogEvidence(
      [
        { id: rawModelId, name: "GLM 5.3" },
        { id: peerModelId, name: "GLM 5.2" },
      ],
      fetch
    );
    assert.deepEqual([...terminalPackages].sort(), [
      "terminal-bench/terminal-bench-2",
      "terminal-bench/terminal-bench-2-1",
    ]);
    assert.equal(refresh.receipts.length, 2);
    for (const receipt of refresh.receipts) {
      assert.equal(receipt.identityStatus, "matched");
      for (const source of Object.values(receipt.sources)) {
        assert.equal(source.status, "found");
        assert.equal(source.complete, true);
        assert.ok(source.records > 0);
      }
    }

    const codingFitness = getTaskFitnessWithSource(rawModelId, "coding", "high");
    const generalFitness = getTaskFitnessWithSource(rawModelId, "default", "high");
    const peerCodingFitness = getTaskFitnessWithSource(peerModelId, "coding", "high");
    const peerGeneralFitness = getTaskFitnessWithSource(peerModelId, "default", "high");
    assert.equal(codingFitness.source, "benchmark_fitness:high");
    assert.equal(generalFitness.source, "benchmark_fitness:high");
    assert.equal(peerCodingFitness.source, "benchmark_fitness:high");
    assert.equal(peerGeneralFitness.source, "benchmark_fitness:high");
    assert.ok(peerCodingFitness.score < codingFitness.score);
    assert.ok(peerGeneralFitness.score < generalFitness.score);
    assert.equal(classifyTier("nvidia", rawModelId).tier, "free");
    assert.equal(classifyTier("nvidia", peerModelId).tier, "free");
    assert.equal(
      getResolvedModelCapabilities({ provider: "nvidia", model: rawModelId }).toolCalling,
      true
    );
    assert.equal(
      getResolvedModelCapabilities({ provider: "nvidia", model: peerModelId }).toolCalling,
      true
    );
    const persistedFitness = getDbInstance().prepare(
      `SELECT score FROM model_intelligence
       WHERE model = ? AND source = 'benchmark_fitness:high' AND category = ?`
    );
    for (const category of ["coding", "default"]) {
      assert.ok(persistedFitness.get(rawModelId, category));
    }

    const targetCandidate = {
      ...makeCandidate("nvidia", rawModelId, 1),
      connectionId: connection.id,
    };
    const peerCandidate = {
      ...makeCandidate("nvidia", peerModelId, 2),
      connectionId: connection.id,
    };
    const prepared = { regularCandidates: [targetCandidate, peerCandidate], familyCandidates: [] };
    const codingCombo = await createVirtualAutoComboFromPrepared(prepared, undefined, {
      category: "coding_high_tools" as never,
      tier: "free",
    });
    const generalCombo = await createVirtualAutoComboFromPrepared(prepared, undefined, {
      category: "general_high_tools" as never,
      tier: "free",
    });

    assert.deepEqual(getReturnedModelIds(codingCombo), [`nvidia/${rawModelId}`]);
    assert.deepEqual(getReturnedModelIds(generalCombo), [`nvidia/${rawModelId}`]);
    assert.equal(targetCandidate.model, rawModelId);
    assert.equal(targetCandidate.modelStr, `nvidia/${rawModelId}`);
  }, 20_000);

  it("intersects the default low range with real tool capability and admits unrated low candidates", async () => {
    const inRangeToolModel = "band-quality-low-tools-in-range";
    const outOfRangeToolModel = "band-quality-low-tools-out-of-range";
    const noToolsModel = "band-quality-low-no-tools";
    const unratedToolModel = "band-quality-low-unrated-tool";

    saveModelsDevCapabilities({
      openai: {
        [inRangeToolModel]: buildCapability(true),
        [outOfRangeToolModel]: buildCapability(true),
        [noToolsModel]: buildCapability(false),
        [unratedToolModel]: buildCapability(true),
      },
    });
    setUserFitnessOverride(inRangeToolModel, "default", 0.55);
    setUserFitnessOverride(outOfRangeToolModel, "default", 0.56);
    setUserFitnessOverride(noToolsModel, "default", 0.4);

    const unratedFitness = getTaskFitnessWithSource(unratedToolModel, "default");
    assert.equal(
      getBandConfig().ratedSources.some((source) => unratedFitness.source.startsWith(source)),
      false
    );
    assert.equal(
      getResolvedModelCapabilities({ provider: "openai", model: noToolsModel }).toolCalling,
      false
    );
    assert.equal(
      getResolvedModelCapabilities({ provider: "openai", model: inRangeToolModel }).toolCalling,
      true
    );
    assert.deepEqual(getBandRange("general", "low"), { min: 0, max: 0.55 });

    const combo = await createVirtualAutoComboFromPrepared(
      {
        regularCandidates: [
          makeCandidate("openai", inRangeToolModel, 1),
          makeCandidate("openai", outOfRangeToolModel, 2),
          makeCandidate("openai", noToolsModel, 3),
          makeCandidate("openai", unratedToolModel, 4),
        ],
        familyCandidates: [],
      },
      undefined,
      { category: "general_low_tools" as never }
    );

    assert.deepEqual(getReturnedModelIds(combo), [
      `openai/${inRangeToolModel}`,
      `openai/${unratedToolModel}`,
    ]);
  });

  it("keeps keyless OpenCode free models in the real free-tier and low-band intersection", async () => {
    const freeInRange = "mimo-v2.5-free";
    const freeOutOfRange = "big-pickle";
    const paidModel = "openai/gpt-4.1";

    assert.equal(classifyTier("opencode", freeInRange).tier, "free");
    assert.notEqual(classifyTier("openrouter", paidModel).tier, "free");
    setUserFitnessOverride(freeInRange, "default", 0.55);
    setUserFitnessOverride(freeOutOfRange, "default", 0.56);
    setUserFitnessOverride(paidModel, "default", 0.55);

    const combo = await createVirtualAutoComboFromPrepared(
      {
        regularCandidates: [
          makeCandidate("opencode", freeInRange, 1),
          makeCandidate("opencode", freeOutOfRange, 2),
          makeCandidate("openrouter", paidModel, 3),
        ],
        familyCandidates: [],
      },
      undefined,
      { category: "general_low" as never, tier: "free" }
    );

    assert.deepEqual(getReturnedModelIds(combo), [`opencode/${freeInRange}`]);
  });

  it("keeps an empty high band empty when the full-pool fallback is disabled", async () => {
    const unratedModel = "quality-band-unrated-model";
    assert.equal(getTaskFitnessWithSource(unratedModel, "coding").source, "wildcard_boost");

    const combo = await createVirtualAutoComboFromPrepared(
      {
        regularCandidates: [makeCandidate("openai", unratedModel, 1)],
        familyCandidates: [],
      },
      undefined,
      { category: "coding_high" as never }
    );

    assert.deepEqual(combo.models, []);
    assert.deepEqual(combo.candidatePool, []);
  });

  it("preserves plain upstream auto/coding:free with bands disabled", async () => {
    process.env.OMNIROUTE_AUTO_BANDS = "0";
    const keylessModel = "mimo-v2.5-free";
    const paidModel = "openai/gpt-4.1";
    setUserFitnessOverride(keylessModel, "coding", 0.95);
    setUserFitnessOverride(paidModel, "coding", 0.5);

    const combo = await createVirtualAutoComboFromPrepared(
      {
        regularCandidates: [
          makeCandidate("opencode", keylessModel, 1),
          makeCandidate("openrouter", paidModel, 2),
        ],
        familyCandidates: [],
      },
      undefined,
      { category: "coding", tier: "free" }
    );

    assert.deepEqual(getReturnedModelIds(combo), [`opencode/${keylessModel}`]);
  });
});
