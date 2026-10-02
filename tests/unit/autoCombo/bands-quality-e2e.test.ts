import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, it } from "vitest";

const previousEnv = {
  dataDir: process.env.DATA_DIR,
  bandsEnabled: process.env.OMNIROUTE_AUTO_BANDS,
  bandsConfig: process.env.OMNIROUTE_AUTO_BANDS_CONFIG,
  fullPoolFallback: process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL,
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
  { resetDbInstance },
  { getBandConfig, getBandRange, setCalibratedBandRanges },
  { classifyTier },
] = await Promise.all([
  import("../../../open-sse/services/autoCombo/virtualFactory"),
  import("../../../open-sse/services/autoCombo/taskFitness"),
  import("../../../src/lib/modelsDevSync"),
  import("../../../src/lib/modelCapabilities"),
  import("../../../src/lib/db/core"),
  import("../../../open-sse/services/autoCombo/bands/config"),
  import("../../../open-sse/services/tierResolver"),
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

function getReturnedModelIds(
  combo: Awaited<ReturnType<typeof createVirtualAutoComboFromPrepared>>
) {
  return combo.models.map((model) => model.model);
}

beforeEach(() => {
  resetStorage();
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  delete process.env.OMNIROUTE_AUTO_BANDS_CONFIG;
  delete process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL;
  setCalibratedBandRanges(null);
  resetEmptyAutoPoolWarnStateForTests();
});

afterAll(() => {
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
});

describe("auto quality-band candidate-pool integration", () => {
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
