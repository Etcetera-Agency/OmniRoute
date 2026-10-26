export type ModelBenchmarkFamily =
  "aa-coding" | "aa-intelligence" | "swe-bench" | "terminal-bench" | "deepswe";
export type ModelBenchmarkFitnessProfile = "low" | "medium" | "high";

export interface ModelBenchmarkFitnessObservation {
  modelId: string;
  family: ModelBenchmarkFamily;
  benchmark: string;
  benchmarkVersion: string | null;
  reasoningEffort: string | null;
  reasoningConfig: unknown;
  metric: string;
  value: number;
  verificationStatus: string;
}

export interface ModelBenchmarkFitness {
  modelId: string;
  codingFitness: number | null;
  generalFitness: number | null;
  codingFamilyVotes: Partial<Record<ModelBenchmarkFamily, number>>;
  generalFamilyVotes: Partial<Record<ModelBenchmarkFamily, number>>;
  sourceCounts: Record<ModelBenchmarkFamily, number>;
  codingFallback: boolean;
  generalFallback: boolean;
  confidence: "high" | "medium" | "low" | "unrated";
  effortProxy?: boolean;
}

const FAMILIES: ModelBenchmarkFamily[] = [
  "aa-coding",
  "aa-intelligence",
  "swe-bench",
  "terminal-bench",
  "deepswe",
];

const BENCHMARK_FAMILIES: ModelBenchmarkFamily[] = ["swe-bench", "terminal-bench", "deepswe"];

const SUPPORTED_METRICS: Record<ModelBenchmarkFamily, ReadonlySet<string>> = {
  "aa-coding": new Set(["artificial_analysis_coding_index"]),
  "aa-intelligence": new Set(["artificial_analysis_intelligence_index"]),
  "swe-bench": new Set(["resolved"]),
  "terminal-bench": new Set(["accuracy"]),
  deepswe: new Set(["pass_rate"]),
};

const ELIGIBLE_STATUSES = new Set([
  "eligible",
  "verified",
  "source_verified",
  "source_verified_review_required",
  "official_leaderboard",
]);

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isObservation(value: unknown): value is ModelBenchmarkFitnessObservation {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ModelBenchmarkFitnessObservation>;
  return (
    typeof row.modelId === "string" &&
    row.modelId.trim().length > 0 &&
    FAMILIES.includes(row.family as ModelBenchmarkFamily) &&
    typeof row.benchmark === "string" &&
    row.benchmark.length > 0 &&
    (row.benchmarkVersion === null || typeof row.benchmarkVersion === "string") &&
    (row.reasoningEffort === null || typeof row.reasoningEffort === "string") &&
    typeof row.metric === "string" &&
    SUPPORTED_METRICS[row.family as ModelBenchmarkFamily].has(row.metric) &&
    typeof row.value === "number" &&
    Number.isFinite(row.value) &&
    typeof row.verificationStatus === "string" &&
    ELIGIBLE_STATUSES.has(row.verificationStatus)
  );
}

function normalizedEffort(observation: ModelBenchmarkFitnessObservation): string {
  const effort = observation.reasoningEffort?.trim().toLowerCase();
  return !effort || effort === "none" || effort === "unknown" ? "unknown" : effort;
}

function selectProfileObservations(
  observations: readonly ModelBenchmarkFitnessObservation[],
  profile: ModelBenchmarkFitnessProfile
): { observations: ModelBenchmarkFitnessObservation[]; proxyModels: Set<string> } {
  const groups = new Map<string, ModelBenchmarkFitnessObservation[]>();
  for (const observation of observations) {
    const key = JSON.stringify([
      observation.modelId,
      observation.family,
      observation.benchmark,
      observation.benchmarkVersion,
      stableJson(observation.reasoningConfig ?? null),
      observation.metric,
    ]);
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }

  const selected: ModelBenchmarkFitnessObservation[] = [];
  const proxyModels = new Set<string>();
  for (const group of groups.values()) {
    const preferredEfforts = profile === "high" ? ["xhigh", "high"] : [profile];
    let matches: ModelBenchmarkFitnessObservation[] = [];
    for (const effort of preferredEfforts) {
      matches = group.filter((observation) => normalizedEffort(observation) === effort);
      if (matches.length) break;
    }
    let effortProxy = false;

    if (matches.length === 0) {
      matches = group.filter((observation) => normalizedEffort(observation) === "unknown");
      effortProxy = matches.length > 0;
    }
    if (matches.length === 0) {
      matches = group;
      effortProxy = true;
    }

    if (effortProxy) proxyModels.add(group[0].modelId);
    selected.push(...matches.map((observation) => ({ ...observation, reasoningEffort: profile })));
  }

  return { observations: selected, proxyModels };
}

export function computeModelBenchmarkFitness(
  observations: readonly ModelBenchmarkFitnessObservation[],
  modelIds: readonly string[] = [],
  profile?: ModelBenchmarkFitnessProfile
): ModelBenchmarkFitness[] {
  // AICODE-NOTE: relative scores rank only comparable cohorts; missing effort/config data never becomes a zero.
  const models = new Set(modelIds.filter((modelId) => modelId.trim().length > 0));
  const unique = new Map<string, ModelBenchmarkFitnessObservation>();

  for (const item of observations) {
    if (!isObservation(item)) continue;
    models.add(item.modelId);
    let configKey: string;
    try {
      configKey = stableJson(item.reasoningConfig ?? null);
    } catch {
      continue;
    }
    const key = JSON.stringify([
      item.modelId,
      item.family,
      item.benchmark,
      item.benchmarkVersion,
      item.reasoningEffort,
      configKey,
      item.metric,
      item.value,
    ]);
    unique.set(key, item);
  }

  const profileSelection = profile
    ? selectProfileObservations([...unique.values()], profile)
    : null;
  const scoringObservations = profileSelection?.observations ?? [...unique.values()];

  const cohorts = new Map<string, ModelBenchmarkFitnessObservation[]>();
  const sourceCountsByModel = new Map<string, Record<ModelBenchmarkFamily, number>>();
  for (const item of scoringObservations) {
    const key = JSON.stringify([
      item.family,
      item.benchmark,
      item.benchmarkVersion,
      item.reasoningEffort,
      stableJson(item.reasoningConfig ?? null),
      item.metric,
    ]);
    const cohort = cohorts.get(key) ?? [];
    cohort.push(item);
    cohorts.set(key, cohort);

    const counts = sourceCountsByModel.get(item.modelId) ?? {
      "aa-coding": 0,
      "aa-intelligence": 0,
      "swe-bench": 0,
      "terminal-bench": 0,
      deepswe: 0,
    };
    counts[item.family] += 1;
    sourceCountsByModel.set(item.modelId, counts);
  }

  const votes = new Map<string, Partial<Record<ModelBenchmarkFamily, number[]>>>();
  for (const cohort of cohorts.values()) {
    const valuesByModel = new Map<string, number[]>();
    for (const item of cohort) {
      const values = valuesByModel.get(item.modelId) ?? [];
      values.push(item.value);
      valuesByModel.set(item.modelId, values);
    }
    if (valuesByModel.size < 2) continue;

    const family = cohort[0].family;
    const sorted = [...valuesByModel]
      .map(([modelId, values]) => ({ modelId, value: median(values)! }))
      .sort((a, b) => a.value - b.value);
    for (let start = 0; start < sorted.length;) {
      let end = start + 1;
      while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
      const percentile = (start + 0.5 * (end - start)) / sorted.length;
      for (const item of sorted.slice(start, end)) {
        const modelVotes = votes.get(item.modelId) ?? {};
        const familyVotes = modelVotes[family] ?? [];
        familyVotes.push(percentile);
        modelVotes[family] = familyVotes;
        votes.set(item.modelId, modelVotes);
      }
      start = end;
    }
  }

  const result: ModelBenchmarkFitness[] = [];
  for (const modelId of models) {
    const familyVotes = votes.get(modelId) ?? {};
    const familyScores: Partial<Record<ModelBenchmarkFamily, number>> = {};
    for (const family of FAMILIES) {
      const score = median(familyVotes[family] ?? []);
      if (score !== null) familyScores[family] = score;
    }

    const benchmarkScores = BENCHMARK_FAMILIES.map((family) => familyScores[family]).filter(
      (score): score is number => score !== undefined
    );
    const codingVotes = [familyScores["aa-coding"], ...benchmarkScores].filter(
      (score): score is number => score !== undefined
    );
    const directCoding = familyScores["aa-coding"] !== undefined || benchmarkScores.length > 0;
    let codingFitness = directCoding ? median(codingVotes) : null;
    let generalFitness = familyScores["aa-intelligence"] ?? null;
    let codingFallback = false;
    let generalFallback = false;

    if ((codingFitness === null) !== (generalFitness === null)) {
      if (codingFitness === null) {
        codingFitness = generalFitness;
        codingFallback = true;
      } else {
        generalFitness = codingFitness;
        generalFallback = true;
      }
    }

    const sourceCounts = sourceCountsByModel.get(modelId) ?? {
      "aa-coding": 0,
      "aa-intelligence": 0,
      "swe-bench": 0,
      "terminal-bench": 0,
      deepswe: 0,
    };
    const hasCoding = familyScores["aa-coding"] !== undefined;
    const hasGeneral = familyScores["aa-intelligence"] !== undefined;
    const effortProxy = profileSelection?.proxyModels.has(modelId) ?? false;
    let confidence: ModelBenchmarkFitness["confidence"] = "medium";
    if (codingFitness === null && generalFitness === null) confidence = "unrated";
    else if (
      codingFallback ||
      generalFallback ||
      effortProxy ||
      (!hasCoding && benchmarkScores.length === 1)
    ) {
      confidence = "low";
    } else if (hasCoding && hasGeneral) confidence = "high";

    result.push({
      modelId,
      codingFitness,
      generalFitness,
      codingFamilyVotes: Object.fromEntries(
        FAMILIES.filter((family) => familyScores[family] !== undefined).map((family) => [
          family,
          familyScores[family],
        ])
      ),
      generalFamilyVotes:
        familyScores["aa-intelligence"] === undefined
          ? {}
          : { "aa-intelligence": familyScores["aa-intelligence"] },
      sourceCounts,
      codingFallback,
      generalFallback,
      confidence,
      ...(profileSelection ? { effortProxy } : {}),
    });
  }

  return result.sort((a, b) => (a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0));
}
