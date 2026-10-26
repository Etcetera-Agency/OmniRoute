import test from "node:test";
import assert from "node:assert/strict";
import { computeModelBenchmarkFitness } from "../../src/lib/modelBenchmarkFitness.ts";

function observation(
  modelId: string,
  family: "aa-coding" | "aa-intelligence" | "swe-bench" | "terminal-bench" | "deepswe",
  value: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    modelId,
    family,
    benchmark: family,
    benchmarkVersion: "1",
    reasoningEffort: null,
    reasoningConfig: null,
    metric:
      family === "aa-coding"
        ? "artificial_analysis_coding_index"
        : family === "aa-intelligence"
          ? "artificial_analysis_intelligence_index"
          : family === "swe-bench"
            ? "resolved"
            : family === "terminal-bench"
              ? "accuracy"
              : "pass_rate",
    value,
    verificationStatus: "eligible",
    ...overrides,
  };
}

test("uses higher-is-better midranks, omits singleton cohorts, and sorts exact model IDs", () => {
  const result = computeModelBenchmarkFitness([
    observation("z/model", "aa-coding", 20),
    observation("a/model", "aa-coding", 10),
  ]);

  assert.deepEqual(
    result.map(({ modelId, codingFitness }) => ({ modelId, codingFitness })),
    [
      { modelId: "a/model", codingFitness: 0.25 },
      { modelId: "z/model", codingFitness: 0.75 },
    ]
  );
  assert.equal(
    computeModelBenchmarkFitness([observation("only/model", "aa-coding", 99)])[0].codingFitness,
    null
  );

  const tied = computeModelBenchmarkFitness([
    observation("a", "aa-coding", 1),
    observation("b", "aa-coding", 1),
    observation("c", "aa-coding", 3),
  ]);
  assert.deepEqual(
    tied.map(({ codingFitness }) => codingFitness),
    [1 / 3, 1 / 3, 5 / 6]
  );
});

test("deduplicates observations and keeps effort, config, version, and metric cohorts separate", () => {
  const rows = [
    observation("a", "aa-coding", 1, { reasoningEffort: "low" }),
    observation("b", "aa-coding", 2, { reasoningEffort: "low" }),
    observation("a", "aa-coding", 100, { reasoningEffort: "high" }),
    observation("b", "aa-coding", 0, { reasoningEffort: "high" }),
    observation("a", "aa-coding", 10, { reasoningConfig: { harness: "x" } }),
    observation("b", "aa-coding", 20, { reasoningConfig: { harness: "x" } }),
    observation("a", "aa-coding", 3, { benchmarkVersion: "2" }),
    observation("b", "aa-coding", 4, { benchmarkVersion: "2" }),
    observation("a", "aa-coding", 3, { metric: "other_index" }),
    observation("b", "aa-coding", 4, { metric: "other_index" }),
  ];
  const result = computeModelBenchmarkFitness([...rows, rows[0]]);

  assert.equal(result.find(({ modelId }) => modelId === "a")?.codingFitness, 0.25);
  assert.equal(result.find(({ modelId }) => modelId === "b")?.codingFitness, 0.75);
  assert.equal(result.find(({ modelId }) => modelId === "a")?.sourceCounts["aa-coding"], 4);
});

test("ranks one median value per exact model within each cohort", () => {
  const result = computeModelBenchmarkFitness([
    observation("a", "aa-coding", 1),
    observation("a", "aa-coding", 1.5),
    observation("b", "aa-coding", 2),
    observation("c", "aa-coding", 3),
  ]);

  assert.deepEqual(
    result.map(({ modelId, codingFitness }) => [modelId, codingFitness]),
    [
      ["a", 1 / 6],
      ["b", 0.5],
      ["c", 5 / 6],
    ]
  );
});

test("aggregates family cohorts by median and coding requires AA or two benchmark families", () => {
  const rows = [
    observation("a", "swe-bench", 1, { benchmarkVersion: "old" }),
    observation("b", "swe-bench", 2, { benchmarkVersion: "old" }),
    observation("a", "swe-bench", 2, { benchmarkVersion: "new" }),
    observation("b", "swe-bench", 1, { benchmarkVersion: "new" }),
    observation("a", "terminal-bench", 1),
    observation("b", "terminal-bench", 2),
  ];
  const result = computeModelBenchmarkFitness(rows);
  const a = result.find(({ modelId }) => modelId === "a")!;
  const b = result.find(({ modelId }) => modelId === "b")!;

  assert.equal(a.codingFamilyVotes["swe-bench"], 0.5);
  assert.equal(a.codingFitness, 0.375);
  assert.equal(b.codingFitness, 0.625);
  assert.equal(a.confidence, "low");

  const [singleFamily] = computeModelBenchmarkFitness([
    observation("single", "swe-bench", 1),
    observation("peer", "swe-bench", 2),
  ]);
  assert.equal(singleFamily.codingFitness, null);
  assert.equal(singleFamily.generalFitness, null);
});

test("AA task scores win direct and reciprocal fallback copies only one measured task", () => {
  const aaRows = [
    observation("a", "aa-coding", 1),
    observation("b", "aa-coding", 2),
    observation("a", "aa-intelligence", 10),
    observation("b", "aa-intelligence", 20),
  ];
  const [a] = computeModelBenchmarkFitness(aaRows);
  assert.equal(a.codingFitness, 0.25);
  assert.equal(a.generalFitness, 0.25);
  assert.equal(a.codingFallback, false);
  assert.equal(a.generalFallback, false);

  const [fallback] = computeModelBenchmarkFitness([
    observation("fallback", "aa-coding", 1),
    observation("peer", "aa-coding", 2),
  ]);
  assert.equal(fallback.codingFitness, 0.25);
  assert.equal(fallback.generalFitness, 0.25);
  assert.equal(fallback.generalFallback, true);
});

test("rejects unverified, malformed, nonfinite, and missing IDs without fabricated scores", () => {
  const rows = [
    observation("good", "aa-coding", 1),
    observation("peer", "aa-coding", 2),
    observation("unverified", "aa-coding", 3, { verificationStatus: "review_required" }),
    observation("nan", "aa-coding", Number.NaN),
    observation("", "aa-coding", 5),
    observation("unsupported", "aa-coding", 1, { metric: "unknown" }),
  ];
  const result = computeModelBenchmarkFitness(rows, ["unseen", "good"]);
  const byId = new Map(result.map((row) => [row.modelId, row]));

  assert.deepEqual(
    result.map(({ modelId }) => modelId),
    ["good", "peer", "unseen"]
  );
  assert.equal(byId.get("unseen")?.codingFitness, null);
  assert.equal(byId.get("unseen")?.generalFitness, null);
  assert.equal(byId.get("unseen")?.confidence, "unrated");
  assert.equal(byId.get("good")?.codingFitness, 0.25);
});
