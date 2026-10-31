import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-model-benchmark-fitness-"));
process.env.DATA_DIR = TEST_DATA_DIR;
const core = await import("../../src/lib/db/core.ts");
const intelligence = await import("../../src/lib/db/modelIntelligence.ts");
const searchDb = await import("../../src/lib/db/modelBenchmarkSearch.ts");
const fitnessSync = await import("../../src/lib/modelBenchmarkFitnessSync.ts");
const { computeModelBenchmarkFitness } = await import("../../src/lib/modelBenchmarkFitness.ts");
const taskFitness = await import("../../open-sse/services/autoCombo/taskFitness.ts");

function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function evidence(
  modelId: string,
  metric: string,
  value: number,
  source = "artificial-analysis-free",
  verificationStatus = "verified",
  benchmark = metric.includes("coding")
    ? "Artificial Analysis Coding Index"
    : "Artificial Analysis Intelligence Index"
) {
  return {
    evidenceHash: `${modelId}:${metric}`,
    modelId,
    source,
    sourceVersion: "v1",
    matchedModelId: modelId,
    matchedModelName: modelId,
    benchmark,
    benchmarkVersion: "2026-10",
    reasoningEffort: "high",
    reasoningConfig: null,
    metric,
    value,
    sourceUrl: "https://artificialanalysis.ai/",
    sourceDate: "2026-10-26",
    verificationStatus,
    capturedAt: "2026-10-26T00:00:00.000Z",
    raw: {},
  };
}

function effortEvidence(modelId: string, value: number, effort: string) {
  return {
    ...evidence(modelId, "artificial_analysis_coding_index", value),
    evidenceHash: `${modelId}:coding:${effort}`,
    reasoningEffort: effort,
  };
}

test.beforeEach(() => resetStorage());
test.afterEach(() => core.resetDbInstance());
test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("publishes measured tasks without replacing manual or Arena ratings", async () => {
  const models = ["model-a", "model-b", "model-c", "unrated-model"].map((id) => ({
    id,
    name: id,
  }));
  searchDb.enqueueModelBenchmarkSearches(models);
  intelligence.upsertModelIntelligence({
    model: "model-a",
    source: "user_override",
    category: "coding",
    score: 0.99,
    eloRaw: null,
    confidence: "manual",
    expiresAt: null,
  });
  intelligence.upsertModelIntelligence({
    model: "model-b",
    source: "arena_elo",
    category: "coding",
    score: 0.95,
    eloRaw: 1500,
    confidence: "high",
    expiresAt: null,
  });
  searchDb.saveModelBenchmarkSearchEvidence([
    evidence("model-a", "artificial_analysis_coding_index", 10),
    evidence("model-b", "artificial_analysis_coding_index", 20),
    evidence("model-c", "artificial_analysis_coding_index", 30),
    evidence("model-a", "artificial_analysis_intelligence_index", 30),
    evidence("model-b", "artificial_analysis_intelligence_index", 20),
    evidence("model-c", "artificial_analysis_intelligence_index", 10),
  ]);

  const result = await fitnessSync.recomputeModelBenchmarkFitness();

  assert.equal(result.observationCount, 6);
  assert.equal(result.publishedCount, 24);
  assert.match(
    intelligence.getModelIntelligenceBySource("model-c", "benchmark_fitness:low", "coding")
      ?.confidence ?? "",
    /effort_proxy/
  );
  assert.equal(
    result.scores.find(({ modelId }) => modelId === "unrated-model")?.codingFitness,
    null
  );
  assert.equal(
    intelligence.getModelIntelligenceBySource("model-a", "benchmark_fitness", "coding")?.score,
    1 / 6
  );
  assert.equal(
    intelligence.getModelIntelligenceBySource("model-c", "benchmark_fitness", "default")?.score,
    1 / 6
  );
  assert.equal(intelligence.getModelIntelligence("model-a", "coding")?.source, "user_override");
  assert.equal(intelligence.getModelIntelligence("model-b", "coding")?.source, "arena_elo");
  assert.equal(intelligence.getModelIntelligence("model-c", "coding")?.source, "benchmark_fitness");
  assert.equal(
    intelligence.getModelIntelligence("model-c", "default")?.source,
    "benchmark_fitness"
  );
  assert.equal(
    intelligence.getModelIntelligenceBySource("unrated-model", "benchmark_fitness", "coding"),
    null
  );

  assert.deepEqual(taskFitness.getTaskFitnessWithSource("model-c", "coding"), {
    score: 5 / 6,
    source: "benchmark_fitness",
  });
  core
    .getDbInstance()
    .prepare("UPDATE model_benchmark_evidence SET value = 0 WHERE model_id = ? AND metric = ?")
    .run("model-c", "artificial_analysis_coding_index");
  await fitnessSync.recomputeModelBenchmarkFitness();

  assert.deepEqual(taskFitness.getTaskFitnessWithSource("model-c", "coding"), {
    score: 1 / 6,
    source: "benchmark_fitness",
  });
});

test("search evidence scores only after its verification status passes the fitness gate", () => {
  const rows = [
    evidence(
      "search-verified",
      "pass@1",
      0.5,
      "duckduckgo-free-structured-output",
      "source_verified_review_required",
      "DeepSWE"
    ),
    evidence("peer", "pass@1", 0.9, "duckduckgo-free-structured-output", "verified", "DeepSWE"),
    evidence(
      "search-verified",
      "accuracy",
      0.5,
      "huggingface-eval-results",
      "verified",
      "Terminal-Bench"
    ),
    evidence("peer", "accuracy", 0.9, "huggingface-eval-results", "verified", "Terminal-Bench"),
    evidence(
      "search-review",
      "pass@1",
      0.99,
      "duckduckgo-free-structured-output",
      "review_required",
      "DeepSWE"
    ),
    evidence(
      "search-review",
      "accuracy",
      0.99,
      "huggingface-eval-results",
      "review_required",
      "Terminal-Bench"
    ),
  ];

  const observations = fitnessSync.getEligibleModelBenchmarkFitnessObservations(rows);
  assert.equal(observations.length, 6);
  assert.equal(observations[0].family, "deepswe");
  const scores = computeModelBenchmarkFitness(observations, [
    "search-verified",
    "search-review",
    "peer",
  ]);
  assert.equal(scores.find(({ modelId }) => modelId === "search-verified")?.codingFitness, 0.25);
  assert.equal(scores.find(({ modelId }) => modelId === "search-review")?.codingFitness, null);
});

test("current normalized search source reaches fitness through the existing family mapping", () => {
  const models = [
    { id: "normalized-target", name: "Normalized Target" },
    { id: "normalized-peer", name: "Normalized Peer" },
  ];
  searchDb.enqueueModelBenchmarkSearches(models);
  const rows = [
    evidence(
      "normalized-target",
      "resolved",
      0.5,
      "ollama-search-structured-output",
      "source_verified_review_required",
      "SWE-bench Verified"
    ),
    evidence(
      "normalized-peer",
      "resolved",
      0.9,
      "ollama-search-structured-output",
      "source_verified_review_required",
      "SWE-bench Verified"
    ),
  ];
  searchDb.saveModelBenchmarkSearchEvidence(rows);

  const observations = fitnessSync.getEligibleModelBenchmarkFitnessObservations(
    searchDb.listAllModelBenchmarkSearchEvidence()
  );
  const published = fitnessSync.publishModelBenchmarkFitnessSnapshot();

  assert.equal(observations.length, 2);
  assert.ok(observations.every(({ family }) => family === "swe-bench"));
  assert.equal(published.observationCount, 2);
  assert.equal(
    published.scores.find(({ modelId }) => modelId === "normalized-target")?.codingFitness,
    0.25
  );
  assert.ok(
    intelligence.getModelIntelligenceBySource("normalized-target", "benchmark_fitness", "coding")
  );
});

test("publishes a single verified benchmark family as low-confidence provisional fitness", async () => {
  searchDb.enqueueModelBenchmarkSearches([
    { id: "single-family", name: "Single Family" },
    { id: "peer", name: "Peer" },
  ]);
  searchDb.saveModelBenchmarkSearchEvidence([
    evidence("single-family", "pass@1", 0.5, "deepswe", "verified", "DeepSWE"),
    evidence("peer", "pass@1", 0.9, "deepswe", "verified", "DeepSWE"),
  ]);

  const result = await fitnessSync.recomputeModelBenchmarkFitness();
  const score = result.scores.find(({ modelId }) => modelId === "single-family")!;
  const published = intelligence.getModelIntelligenceBySource(
    "single-family",
    "benchmark_fitness",
    "coding"
  );

  assert.equal(score.codingFitness, 0.25);
  assert.equal(score.generalFitness, 0.25);
  assert.equal(score.confidence, "low");
  assert.equal(published?.score, 0.25);
  assert.equal(published?.confidence, "low");
  assert.equal(
    intelligence.getModelIntelligenceBySource("single-family", "benchmark_fitness", "default")
      ?.confidence,
    "low:reciprocal_task_fallback"
  );
});

test("publishes profile scores separately, preserves global score, and removes stale profiles", async () => {
  searchDb.enqueueModelBenchmarkSearches(
    ["model-a", "model-b", "model-c"].map((id) => ({
      id,
      name: id,
    }))
  );
  searchDb.saveModelBenchmarkSearchEvidence([
    effortEvidence("model-a", 10, "low"),
    effortEvidence("model-b", 20, "low"),
    effortEvidence("model-c", 30, "low"),
    effortEvidence("model-a", 30, "medium"),
    effortEvidence("model-b", 20, "medium"),
    effortEvidence("model-c", 10, "medium"),
    effortEvidence("model-a", 1, "high"),
    effortEvidence("model-a", 50, "xhigh"),
    effortEvidence("model-b", 30, "high"),
    effortEvidence("model-c", 20, "high"),
  ]);

  const result = await fitnessSync.recomputeModelBenchmarkFitness();
  assert.equal(result.scores.find(({ modelId }) => modelId === "model-a")?.codingFitness, 1 / 6);
  assert.equal(
    intelligence.getModelIntelligenceBySource("model-a", "benchmark_fitness:low", "coding")?.score,
    1 / 6
  );
  assert.equal(
    intelligence.getModelIntelligenceBySource("model-a", "benchmark_fitness:medium", "coding")
      ?.score,
    5 / 6
  );
  assert.equal(
    intelligence.getModelIntelligenceBySource("model-a", "benchmark_fitness:high", "coding")?.score,
    5 / 6
  );
  assert.notEqual(
    intelligence.getModelIntelligenceBySource("model-a", "benchmark_fitness", "coding")?.score,
    intelligence.getModelIntelligenceBySource("model-a", "benchmark_fitness:high", "coding")?.score
  );
  assert.deepEqual(taskFitness.getTaskFitnessWithSource("model-a", "coding"), {
    score: 1 / 6,
    source: "benchmark_fitness",
  });

  core.getDbInstance().prepare("DELETE FROM model_benchmark_evidence").run();
  await fitnessSync.recomputeModelBenchmarkFitness();
  for (const profile of ["low", "medium", "high"]) {
    assert.equal(
      intelligence.getModelIntelligenceBySource(
        "model-a",
        `benchmark_fitness:${profile}`,
        "coding"
      ),
      null
    );
  }
});

test("profile scores precede global scores while manual and Arena scores retain priority", () => {
  intelligence.upsertModelIntelligence({
    model: "gpt-5.6-sol",
    source: "benchmark_fitness",
    category: "coding",
    score: 0.2,
    eloRaw: null,
    confidence: "medium",
    expiresAt: null,
  });
  intelligence.upsertModelIntelligence({
    model: "gpt-5.6-sol",
    source: "benchmark_fitness:high",
    category: "coding",
    score: 0.8,
    eloRaw: null,
    confidence: "high",
    expiresAt: null,
  });
  taskFitness.invalidateFitnessCache();

  assert.deepEqual(taskFitness.getTaskFitnessWithSource("gpt-5.6-sol", "coding", "high"), {
    score: 0.8,
    source: "benchmark_fitness:high",
  });
  assert.deepEqual(taskFitness.getTaskFitnessWithSource("gpt-5.6-sol-xhigh", "coding", "high"), {
    score: 0.8,
    source: "benchmark_fitness:high:inherited",
  });
  assert.deepEqual(taskFitness.getTaskFitnessWithSource("gpt-5.6-sol", "coding", "medium"), {
    score: 0.2,
    source: "benchmark_fitness",
  });
  assert.deepEqual(taskFitness.getTaskFitnessWithSource("gpt-5.6-sol", "coding"), {
    score: 0.2,
    source: "benchmark_fitness",
  });

  intelligence.upsertModelIntelligence({
    model: "gpt-5.6-sol",
    source: "user_override",
    category: "coding",
    score: 0.99,
    eloRaw: null,
    confidence: "manual",
    expiresAt: null,
  });
  intelligence.upsertModelIntelligence({
    model: "mimo-v2.5",
    source: "benchmark_fitness:high",
    category: "coding",
    score: 0.8,
    eloRaw: null,
    confidence: "high",
    expiresAt: null,
  });
  intelligence.upsertModelIntelligence({
    model: "mimo-v2.5",
    source: "arena_elo",
    category: "coding",
    score: 0.95,
    eloRaw: 1500,
    confidence: "high",
    expiresAt: null,
  });
  taskFitness.invalidateFitnessCache();

  assert.deepEqual(taskFitness.getTaskFitnessWithSource("gpt-5.6-sol", "coding", "high"), {
    score: 0.99,
    source: "user_override",
  });
  assert.deepEqual(taskFitness.getTaskFitnessWithSource("gpt-5.6-sol-xhigh", "coding", "high"), {
    score: 0.99,
    source: "user_override:inherited",
  });
  assert.deepEqual(taskFitness.getTaskFitnessWithSource("mimo-v2.5", "coding", "high"), {
    score: 0.95,
    source: "arena_elo",
  });
  assert.deepEqual(taskFitness.getTaskFitnessWithSource("mimo-v2.5-free", "coding", "high"), {
    score: 0.95,
    source: "arena_elo:inherited",
  });
});

test("publishes complete current snapshot inside its transaction and removes stale owned rows", async () => {
  searchDb.enqueueModelBenchmarkSearches([
    { id: "inactive-canonical", name: "Inactive Canonical" },
    { id: "peer", name: "Peer" },
  ]);
  searchDb.updateModelBenchmarkSearchIdentityStatuses([
    { id: "inactive-canonical", status: "review_required" },
  ]);
  for (const source of [
    "benchmark_fitness",
    "benchmark_fitness:low",
    "benchmark_fitness:medium",
    "benchmark_fitness:high",
    "arena_elo",
  ]) {
    intelligence.upsertModelIntelligence({
      model: "stale-model",
      source,
      category: "coding",
      score: 0.9,
      eloRaw: null,
      confidence: "high",
      expiresAt: null,
    });
  }

  let published: ReturnType<typeof fitnessSync.publishModelBenchmarkFitnessSnapshot> | undefined;
  searchDb.replaceModelBenchmarkEvidenceSources(
    [
      {
        modelId: "inactive-canonical",
        source: "deepswe",
        rows: [evidence("inactive-canonical", "pass@1", 0.5, "deepswe", "verified", "DeepSWE")],
      },
      {
        modelId: "peer",
        source: "deepswe",
        rows: [evidence("peer", "pass@1", 0.9, "deepswe", "verified", "DeepSWE")],
      },
    ],
    () => {
      assert.equal(core.getDbInstance().inTransaction, true);
      published = fitnessSync.publishModelBenchmarkFitnessSnapshot();
      assert.equal(
        intelligence.getModelIntelligenceBySource(
          "inactive-canonical",
          "benchmark_fitness",
          "coding"
        )?.score,
        0.25
      );
    }
  );

  assert.ok(published);
  assert.equal(
    published.scores.find(({ modelId }) => modelId === "inactive-canonical")?.codingFitness,
    0.25
  );
  assert.equal(published.publishedCount, 16);
  assert.equal(published.profilePublishedCount, 12);
  assert.equal(published.deletedCount, 4);
  for (const source of [
    "benchmark_fitness",
    "benchmark_fitness:low",
    "benchmark_fitness:medium",
    "benchmark_fitness:high",
  ]) {
    assert.equal(intelligence.getModelIntelligenceBySource("stale-model", source, "coding"), null);
  }
  assert.equal(
    intelligence.getModelIntelligenceBySource("stale-model", "arena_elo", "coding")?.score,
    0.9
  );
  assert.equal(
    intelligence.getModelIntelligenceBySource("inactive-canonical", "benchmark_fitness", "coding")
      ?.model,
    "inactive-canonical"
  );
  assert.equal(
    intelligence.getModelIntelligenceBySource(
      "provider/inactive-canonical",
      "benchmark_fitness",
      "coding"
    ),
    null
  );

  await fitnessSync.invalidateModelBenchmarkFitnessCache();
  assert.deepEqual(taskFitness.getTaskFitnessWithSource("inactive-canonical", "coding"), {
    score: 0.25,
    source: "benchmark_fitness",
  });
  assert.deepEqual(taskFitness.getTaskFitnessWithSource("inactive-canonical", "default"), {
    score: 0.25,
    source: "benchmark_fitness",
  });
  assert.notEqual(
    taskFitness.getTaskFitnessWithSource("provider/inactive-canonical", "coding").source,
    "benchmark_fitness"
  );
});

test("empty canonical catalog cannot delete existing benchmark fitness", () => {
  intelligence.upsertModelIntelligence({
    model: "preserved-model",
    source: "benchmark_fitness",
    category: "coding",
    score: 0.75,
    eloRaw: null,
    confidence: "high",
    expiresAt: null,
  });

  assert.throws(() => fitnessSync.publishModelBenchmarkFitnessSnapshot(), /without catalog models/);
  assert.equal(
    intelligence.getModelIntelligenceBySource("preserved-model", "benchmark_fitness", "coding")
      ?.score,
    0.75
  );
});
