import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-apinex-canonical-binding-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
const ORIGINAL_BANDS_ENABLED = process.env.OMNIROUTE_AUTO_BANDS;
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.OMNIROUTE_AUTO_BANDS = "1";

const [
  core,
  providersDb,
  modelsDb,
  settingsDb,
  modelCapabilities,
  modelsDevSync,
  modelIntelligence,
  taskFitness,
  scoresAs,
  virtualFactory,
] = await Promise.all([
  import("../../src/lib/db/core.ts"),
  import("../../src/lib/db/providers.ts"),
  import("../../src/lib/db/models.ts"),
  import("../../src/lib/db/settings.ts"),
  import("../../src/lib/modelCapabilities.ts"),
  import("../../src/lib/modelsDevSync.ts"),
  import("../../src/lib/db/modelIntelligence.ts"),
  import("../../open-sse/services/autoCombo/taskFitness.ts"),
  import("../../open-sse/services/autoCombo/scoresAs.ts"),
  import("../../open-sse/services/autoCombo/virtualFactory.ts"),
]);

const PROVIDER = "openai-compatible-chat-tl322-canonical-binding";
const RAW_MODEL = "free/muse-spark-1.3";
const BASE_MODEL = "muse-spark-1.3";

function buildCapability(toolCall: boolean, reasoning: boolean) {
  return {
    tool_call: toolCall,
    reasoning,
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

async function createNode(): Promise<void> {
  await providersDb.createProviderNode({
    id: PROVIDER,
    type: "openai-compatible",
    name: "APInex canonical binding fixture",
    prefix: "apinex-tl322",
    apiType: "chat",
    baseUrl: "https://apinex.invalid/v1",
  });
}

function saveScore(
  model: string,
  source: string,
  category: string,
  score: number,
  expiresAt: string | null = null
): void {
  modelIntelligence.upsertModelIntelligence({
    model,
    source,
    category,
    score,
    eloRaw: null,
    confidence: null,
    expiresAt,
  });
  taskFitness.invalidateFitnessCache();
}

test.beforeEach(async () => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  modelsDevSync.saveModelsDevCapabilities({});
  taskFitness.invalidateFitnessCache();
  await settingsDb.updateSettings({ excludeTosAvoid: false });
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  if (ORIGINAL_BANDS_ENABLED === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = ORIGINAL_BANDS_ENABLED;
});

test("free-prefix binding accepts only an exact catalog identity", () => {
  assert.deepEqual(scoresAs.resolveScoresAs(RAW_MODEL), {
    base: BASE_MODEL,
    via: "free-prefix",
  });
  assert.deepEqual(scoresAs.resolveScoresAs("free/kimi"), {
    base: "kimi",
    via: "free-prefix",
  });
  for (const unknown of ["free/unknown-model", "free/muse-spark-1", "free/vendor/muse-spark-1.3"]) {
    assert.deepEqual(scoresAs.resolveScoresAs(unknown), { base: unknown, via: null });
  }
});

test("capabilities reuse unanimous exact-ID fields but keep raw identities and provider overrides", async () => {
  await createNode();

  modelsDevSync.saveModelsDevCapabilities({
    [PROVIDER]: {
      [BASE_MODEL]: { ...buildCapability(false, false), limit_context: 8192 },
    },
  });
  const exactSynced = modelCapabilities.getResolvedModelCapabilities({
    provider: PROVIDER,
    model: RAW_MODEL,
  });
  assert.equal(exactSynced.supportsTools, false);
  assert.equal(exactSynced.contextWindow, 8192);

  const unknownWithCanonicalLeaf = modelCapabilities.getResolvedModelCapabilities({
    provider: PROVIDER,
    model: "free/vendor/muse-spark-1.3",
  });
  assert.equal(unknownWithCanonicalLeaf.supportsTools, null);
  assert.equal(unknownWithCanonicalLeaf.contextWindow, null);
  const unknownEffortVariant = modelCapabilities.getResolvedModelCapabilities({
    provider: PROVIDER,
    model: "free/muse-spark-1.3-high",
  });
  assert.equal(unknownEffortVariant.supportsTools, null);
  assert.equal(unknownEffortVariant.contextWindow, null);
  const unknownVisionFamily = modelCapabilities.getResolvedModelCapabilities({
    provider: PROVIDER,
    model: "free/vendor/pixtral-12b",
  });
  assert.equal(unknownVisionFamily.supportsVision, null);

  modelsDevSync.saveModelsDevCapabilities({});

  const inherited = modelCapabilities.getResolvedModelCapabilities({
    provider: PROVIDER,
    model: RAW_MODEL,
  });
  assert.equal(inherited.provider, PROVIDER);
  assert.equal(inherited.model, RAW_MODEL);
  assert.equal(inherited.rawModel, RAW_MODEL);
  assert.equal(inherited.supportsTools, true);
  assert.equal(inherited.supportsVision, true);
  assert.equal(inherited.supportsThinking, true);
  assert.equal(inherited.contextWindow, 1048576);
  assert.equal(inherited.maxOutputTokens, null, "conflicting registry limits stay unknown");
  assert.equal(
    modelCapabilities.getExplicitModelOutputCap({ provider: PROVIDER, model: RAW_MODEL }),
    null
  );

  const unknown = modelCapabilities.getResolvedModelCapabilities({
    provider: PROVIDER,
    model: "free/vendor/muse-spark-1.3",
  });
  assert.equal(unknown.supportsTools, null);
  assert.equal(unknown.supportsVision, null);
  assert.equal(unknown.supportsThinking, null);

  modelsDevSync.saveModelsDevCapabilities({
    [PROVIDER]: { [RAW_MODEL]: buildCapability(false, false) },
  });
  await modelsDb.addCustomModel(
    PROVIDER,
    RAW_MODEL,
    "Muse Spark 1.3",
    "manual",
    "chat-completions",
    ["chat"],
    undefined,
    {},
    false
  );
  const overridden = modelCapabilities.getResolvedModelCapabilities({
    provider: PROVIDER,
    model: RAW_MODEL,
  });
  assert.equal(overridden.supportsTools, false);
  assert.equal(overridden.supportsVision, false);
  assert.equal(overridden.supportsThinking, false);
});

test("free IDs inherit existing fitness priority, profiles, and expiry without score changes", () => {
  saveScore(BASE_MODEL, "benchmark_fitness", "coding", 0.82);
  saveScore(BASE_MODEL, "benchmark_fitness", "general", 0.74);
  for (const task of ["coding", "general"]) {
    const base = taskFitness.getTaskFitnessWithSource(BASE_MODEL, task);
    const inherited = taskFitness.getTaskFitnessWithSource(RAW_MODEL, task);
    assert.equal(inherited.score, base.score);
    assert.equal(inherited.source, "benchmark_fitness:inherited");
  }

  for (const [profile, codingScore, generalScore] of [
    ["low", 0.42, 0.36],
    ["medium", 0.63, 0.57],
    ["high", 0.91, 0.86],
  ] as const) {
    saveScore(BASE_MODEL, `benchmark_fitness:${profile}`, "coding", codingScore);
    saveScore(BASE_MODEL, `benchmark_fitness:${profile}`, "general", generalScore);
    for (const [task, expected] of [
      ["coding", codingScore],
      ["general", generalScore],
    ] as const) {
      const base = taskFitness.getTaskFitnessWithSource(BASE_MODEL, task, profile);
      const inherited = taskFitness.getTaskFitnessWithSource(RAW_MODEL, task, profile);
      assert.equal(inherited.score, base.score);
      assert.equal(inherited.score, expected);
      assert.equal(inherited.source, `benchmark_fitness:${profile}:inherited`);
    }
  }

  saveScore(BASE_MODEL, "user_override", "coding", 0.97);
  saveScore(BASE_MODEL, "arena_elo", "coding", 0.99);
  assert.deepEqual(taskFitness.getTaskFitnessWithSource(RAW_MODEL, "coding"), {
    score: 0.97,
    source: "user_override:inherited",
  });
  saveScore("kimi", "user_override", "coding", 0.66);
  assert.deepEqual(taskFitness.getTaskFitnessWithSource("free/kimi", "coding"), {
    score: 0.66,
    source: "user_override:inherited",
  });

  saveScore(BASE_MODEL, "arena_elo", "math", 0.99, "2000-01-01T00:00:00.000Z");
  const expired = taskFitness.getTaskFitnessWithSource(RAW_MODEL, "math");
  assert.notEqual(expired.score, 0.99);
  assert.notEqual(expired.source, "arena_elo:inherited");
  for (const unknown of ["free/muse-spark-1", "free/vendor/muse-spark-1.3"]) {
    assert.notEqual(
      taskFitness.getTaskFitnessWithSource(unknown, "coding").source,
      "benchmark_fitness:inherited"
    );
  }
});

test("AutoCombo keeps the raw APInex ID, exact hidden key, and connection allowlist through band filtering", async () => {
  await createNode();
  const connections = await Promise.all(
    [
      { name: "raw exclusion", excludedModels: RAW_MODEL },
      { name: "base exclusion", excludedModels: BASE_MODEL },
      { name: "allowed", excludedModels: undefined },
    ].map(({ name, excludedModels }) =>
      providersDb.createProviderConnection({
        provider: PROVIDER,
        authType: "apikey",
        name: `APInex ${name}`,
        apiKey: `tl322-test-${name.replaceAll(" ", "-")}`,
        isActive: true,
        testStatus: "active",
        providerSpecificData: excludedModels ? { excludedModels } : {},
      })
    )
  );
  for (const connection of connections) {
    await modelsDb.replaceSyncedAvailableModelsForConnection(PROVIDER, connection.id, [
      { id: RAW_MODEL, name: "Muse Spark 1.3", source: "imported", supportedEndpoints: ["chat"] },
    ]);
  }

  modelsDb.setModelIsHidden(PROVIDER, RAW_MODEL, true);
  const hidden = await virtualFactory.prepareVirtualAutoComboInputs({
    includeResolvedCapabilities: true,
  });
  assert.equal(
    hidden.regularCandidates.some((candidate) => candidate.provider === PROVIDER),
    false
  );

  modelsDb.setModelIsHidden(PROVIDER, RAW_MODEL, false);
  modelsDb.setModelIsHidden(PROVIDER, BASE_MODEL, true);
  taskFitness.setUserFitnessOverride(BASE_MODEL, "coding", 0.9);
  const prepared = await virtualFactory.prepareVirtualAutoComboInputs({
    includeResolvedCapabilities: true,
  });
  const candidates = prepared.regularCandidates.filter(
    (candidate) => candidate.provider === PROVIDER
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.model, RAW_MODEL);
  assert.equal(candidates[0]!.modelStr, `${PROVIDER}/${RAW_MODEL}`);
  assert.deepEqual(candidates[0]!.allowedConnectionIds, [connections[2]!.id]);
  assert.equal(candidates[0]!.resolvedSupportsVision, true);
  assert.equal(candidates[0]!.resolvedReasoning, true);
  assert.equal(candidates[0]!.resolvedSupportsThinking, true);
  assert.equal(candidates[0]!.resolvedContextLength, 1048576);
  assert.equal(candidates[0]!.resolvedMaxOutputTokens, null);

  const combo = await virtualFactory.createVirtualAutoComboFromPrepared(prepared, undefined, {
    category: "coding_high_tools" as never,
  });
  assert.deepEqual(
    combo.models.map((model) => model.model),
    [`${PROVIDER}/${RAW_MODEL}`]
  );
  assert.equal(combo.candidatePool.length, 1, "inherited metadata must not widen the pool");
});
