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
  assert.equal(result.publishedCount, 6);
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
    .prepare(
      "UPDATE model_benchmark_search_evidence SET value = 0 WHERE model_id = ? AND metric = ?"
    )
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
