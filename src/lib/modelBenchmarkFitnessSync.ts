import { bulkUpsertModelIntelligence } from "./db/modelIntelligence";
import {
  listAllModelBenchmarkSearchEvidence,
  listModelBenchmarkSearchCatalogModels,
  type ModelBenchmarkSearchEvidence,
} from "./db/modelBenchmarkSearch";
import {
  computeModelBenchmarkFitness,
  type ModelBenchmarkFamily,
  type ModelBenchmarkFitness,
  type ModelBenchmarkFitnessObservation,
} from "./modelBenchmarkFitness";

export const MODEL_BENCHMARK_FITNESS_SOURCE = "benchmark_fitness";

function asBenchmarkFamily(row: ModelBenchmarkSearchEvidence): ModelBenchmarkFamily | null {
  if (row.source === "artificial-analysis-free") {
    if (row.metric === "artificial_analysis_coding_index") return "aa-coding";
    if (row.metric === "artificial_analysis_intelligence_index") return "aa-intelligence";
    return null;
  }
  if (row.source === "swe-bench") return "swe-bench";
  if (row.source === "terminal-bench-2.0" || row.source === "terminal-bench-2.1") {
    return "terminal-bench";
  }
  if (row.source === "deepswe") return "deepswe";
  if (
    row.source !== "huggingface-eval-results" &&
    row.source !== "duckduckgo-free-structured-output"
  ) {
    return null;
  }

  const benchmark = row.benchmark?.toLocaleLowerCase("en-US") ?? "";
  if (benchmark.includes("swe-bench")) return "swe-bench";
  if (benchmark.includes("terminal-bench")) return "terminal-bench";
  if (benchmark.includes("deepswe")) return "deepswe";
  return null;
}

function canonicalMetric(family: ModelBenchmarkFamily, metric: string | null): string | null {
  if (!metric) return null;
  const normalized = metric
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s-]+/g, "_");
  if (family === "aa-coding" && normalized === "artificial_analysis_coding_index")
    return normalized;
  if (family === "aa-intelligence" && normalized === "artificial_analysis_intelligence_index") {
    return normalized;
  }
  if (family === "swe-bench" && ["resolved", "resolved_rate"].includes(normalized)) {
    return "resolved";
  }
  if (
    family === "terminal-bench" &&
    ["accuracy", "pass_rate", "success_rate"].includes(normalized)
  ) {
    return "accuracy";
  }
  if (
    family === "deepswe" &&
    ["pass_rate", "accuracy", "pass@1", "pass_at_1"].includes(normalized)
  ) {
    return "pass_rate";
  }
  return null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function getEligibleModelBenchmarkFitnessObservations(
  evidence: readonly ModelBenchmarkSearchEvidence[]
): ModelBenchmarkFitnessObservation[] {
  const latest = new Map<
    string,
    { observation: ModelBenchmarkFitnessObservation; capturedAt: string }
  >();
  for (const row of evidence) {
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) continue;
    const family = asBenchmarkFamily(row);
    if (!family) continue;
    const metric = canonicalMetric(family, row.metric);
    if (!metric || !row.benchmark) continue;

    const observation: ModelBenchmarkFitnessObservation = {
      modelId: row.modelId,
      family,
      benchmark: row.benchmark,
      benchmarkVersion: row.benchmarkVersion,
      reasoningEffort: row.reasoningEffort,
      reasoningConfig: row.reasoningConfig,
      metric,
      value: row.value,
      verificationStatus: row.verificationStatus,
    };
    const key = JSON.stringify([
      row.modelId,
      row.source,
      family,
      row.benchmark,
      row.benchmarkVersion,
      row.reasoningEffort,
      stableJson(row.reasoningConfig),
      metric,
    ]);
    const current = latest.get(key);
    if (!current || row.capturedAt >= current.capturedAt) {
      latest.set(key, { observation, capturedAt: row.capturedAt });
    }
  }
  return [...latest.values()].map(({ observation }) => observation);
}

export async function recomputeModelBenchmarkFitness(): Promise<{
  scores: ModelBenchmarkFitness[];
  observationCount: number;
  publishedCount: number;
}> {
  const models = listModelBenchmarkSearchCatalogModels();
  const evidence = listAllModelBenchmarkSearchEvidence();
  const observations = getEligibleModelBenchmarkFitnessObservations(evidence);
  const scores = computeModelBenchmarkFitness(
    observations,
    models.map((model) => model.id.toLowerCase())
  );
  const entries = scores.flatMap((score) => {
    const confidence = (fallback: boolean) =>
      `${score.confidence}${fallback ? ":reciprocal_task_fallback" : ""}`;
    const common = { model: score.modelId.toLowerCase(), source: MODEL_BENCHMARK_FITNESS_SOURCE };
    return [
      ...(score.codingFitness === null
        ? []
        : [
            {
              ...common,
              category: "coding",
              score: score.codingFitness,
              eloRaw: null,
              confidence: confidence(score.codingFallback),
              expiresAt: null,
            },
          ]),
      ...(score.generalFitness === null
        ? []
        : [
            {
              ...common,
              // AICODE-NOTE: taskFitness stores general-task scores under `default`.
              category: "default",
              score: score.generalFitness,
              eloRaw: null,
              confidence: confidence(score.generalFallback),
              expiresAt: null,
            },
          ]),
    ];
  });
  const publishedCount = bulkUpsertModelIntelligence(entries);
  if (publishedCount > 0) {
    const { invalidateFitnessCache } =
      await import("@omniroute/open-sse/services/autoCombo/taskFitness");
    invalidateFitnessCache();
  }
  return { scores, observationCount: observations.length, publishedCount };
}
