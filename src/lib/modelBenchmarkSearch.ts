import { createHash } from "node:crypto";
import { getSearchProvider } from "@omniroute/open-sse/config/searchRegistry.ts";
import { executeWebSearch } from "./search/executeWebSearch";
import type { ModelBenchmarkFitness } from "./modelBenchmarkFitness";
import {
  NORMALIZATION_BLOCK_REASON,
  NORMALIZATION_MODEL,
  processModelBenchmarkSearchResults,
} from "./modelBenchmarkSearchProcessor";
import {
  claimModelBenchmarkSearch,
  expireExhaustedModelBenchmarkSearchRuns,
  finishModelBenchmarkSearch,
  getModelBenchmarkSearchStaleRetryDelay,
  hasEligibleModelBenchmarkSearch,
  isModelBenchmarkSearchNameUnique,
  listEligibleModelBenchmarkSearchRuns,
  saveModelBenchmarkSearchEvidence,
  type ModelBenchmarkSearchEvidenceInput,
  type ModelBenchmarkSearchRun,
} from "./db/modelBenchmarkSearch";
import { recomputeModelBenchmarkFitness } from "./modelBenchmarkFitnessSync";

const AA_FREE_URL = "https://artificialanalysis.ai/api/v2/language/models/free";
const SWE_BENCH_URL =
  "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json";
const TERMINAL_BENCH_URL = "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read";
const DEEP_SWE_URL = "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json";
const HF_MODELS_URL = "https://huggingface.co/api/models";
const REQUEST_TIMEOUT_MS = 6_000;
const MAX_AA_PAGES = 5;
const MAX_HF_RESULTS = 10;
const SHARED_SOURCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MODELS_PER_DRAIN = 20;
const CONTINUE_DRAIN_DELAY_MS = 60_000;
export const OLLAMA_SEARCH = {
  provider: "ollama-search",
  maxResults: 10,
} as const;

type JsonRecord = Record<string, unknown>;
type SourceStatus = "found" | "missing" | "error" | "incomplete";
type OfficialSourceName = "swe-bench" | "terminal-bench-2.0" | "terminal-bench-2.1" | "deepswe";

interface ModelIdentity {
  id: string;
  name: string;
}

interface ParsedEvidence {
  source: string;
  sourceVersion: string | null;
  matchedModelId: string | null;
  matchedModelName: string | null;
  benchmark: string | null;
  benchmarkVersion: string | null;
  reasoningEffort: string | null;
  reasoningConfig: unknown;
  metric: string | null;
  value: number | null;
  sourceUrl: string;
  sourceDate: string | null;
  verificationStatus: string;
  raw: unknown;
}

interface SourceCheck {
  status: SourceStatus;
  sourceUrl: string;
  sourceVersion: string | null;
  sourceDate: string | null;
  responseHash: string | null;
  error?: string;
  matches: ParsedEvidence[];
}

interface ModelSourceEvidence {
  checks: SourceCheck[];
  sourceStatus: Record<string, unknown>;
}

interface SearchRunOutcome {
  modelId: string;
  normalizationStatus: string;
  sourceStatus: Record<string, unknown>;
  discoveredEvidence: boolean;
  lastError: string | null;
}

interface SourceSnapshot extends Omit<SourceCheck, "matches"> {
  allRows: ParsedEvidence[];
}

interface BenchmarkSourceSnapshot {
  aa: SourceSnapshot;
  official: Record<OfficialSourceName, SourceSnapshot>;
}

let sharedSourceSnapshotCache: {
  fetchImpl: typeof fetch;
  loadedAt: number;
  promise: Promise<BenchmarkSourceSnapshot>;
} | null = null;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asRows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function folded(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLocaleLowerCase("en-US") : null;
}

function aaReasoningEffort(name: string | null): string | null {
  return name?.match(/\((low|medium|high|xhigh)\)$/i)?.[1]?.toLowerCase() ?? null;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exactIdentityFields(model: ModelIdentity, values: string[]): boolean {
  const modelValues = new Set([folded(model.id), folded(model.name)].filter(Boolean));
  return values.some((value) => modelValues.has(folded(value)));
}

// AICODE-NOTE: a negative source result is valid only after a complete AA scan and all four
// configured official leaderboard datasets have succeeded. This queue never publishes scores.
export function exactModelMatch(model: ModelIdentity, values: unknown[]): boolean {
  return exactIdentityFields(
    model,
    values.filter((value): value is string => typeof value === "string")
  );
}

export function isCompleteMissingFromKnownLeaderboards(input: {
  aa: SourceStatus;
  official: SourceStatus[];
}): boolean {
  return (
    input.aa === "missing" &&
    input.official.length === 4 &&
    input.official.every((source) => source === "missing")
  );
}

function sourceReceipt(
  status: SourceStatus,
  sourceUrl: string,
  raw: unknown,
  sourceVersion: string | null,
  sourceDate: string | null,
  matches: ParsedEvidence[],
  error?: string
): SourceCheck {
  return {
    status,
    sourceUrl,
    sourceVersion,
    sourceDate,
    responseHash: raw === null ? null : hash(raw),
    matches,
    ...(error ? { error: error.slice(0, 300) } : {}),
  };
}

function sourceStatusForStorage(source: SourceCheck): Record<string, unknown> {
  return {
    status: source.status,
    sourceUrl: source.sourceUrl,
    sourceVersion: source.sourceVersion,
    sourceDate: source.sourceDate,
    responseHash: source.responseHash,
    matchedRecords: source.matches.length,
    ...(source.error ? { error: source.error } : {}),
  };
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<{ data: unknown; response: Response }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
        cache: "no-store",
      });
      if ((response.status === 429 || response.status >= 500) && attempt === 0) {
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { data: await response.json(), response };
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
      if (attempt === 0 && retryable) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Source request failed");
}

function responseDate(response: Response): string | null {
  return response.headers.get("last-modified") ?? response.headers.get("date");
}

function evidence(
  values: Partial<ParsedEvidence> & Pick<ParsedEvidence, "source" | "sourceUrl" | "raw">
): ParsedEvidence {
  return {
    source: values.source,
    sourceVersion: values.sourceVersion ?? null,
    matchedModelId: values.matchedModelId ?? null,
    matchedModelName: values.matchedModelName ?? null,
    benchmark: values.benchmark ?? null,
    benchmarkVersion: values.benchmarkVersion ?? null,
    reasoningEffort: values.reasoningEffort ?? null,
    reasoningConfig: values.reasoningConfig ?? null,
    metric: values.metric ?? null,
    value: values.value ?? null,
    sourceUrl: values.sourceUrl,
    sourceDate: values.sourceDate ?? null,
    verificationStatus: values.verificationStatus ?? "source_record_unreviewed",
    raw: values.raw,
  };
}

export function parseDeepSweEvidence(data: unknown): ParsedEvidence[] {
  const root = asRecord(data);
  const rows = asRows(root.rows);
  return rows.map((row) => {
    const model = asString(row.model);
    const effort = asString(row.reasoning_effort);
    return evidence({
      source: "deepswe",
      sourceUrl: DEEP_SWE_URL,
      sourceVersion: "DeepSWE v1.1",
      matchedModelId: model,
      matchedModelName: model,
      benchmark: "DeepSWE",
      benchmarkVersion: "v1.1",
      reasoningEffort: effort,
      reasoningConfig: row.config ?? null,
      metric: asFiniteNumber(row.pass_rate) !== null ? "pass_rate" : null,
      value: asFiniteNumber(row.pass_rate),
      sourceDate: asString(root.generated_at),
      verificationStatus: "official_leaderboard",
      raw: row,
    });
  });
}

export function parseTerminalEvidence(data: unknown, version: "2.0" | "2.1"): ParsedEvidence[] {
  const rows = asRows(asRecord(data).rows);
  return rows.map((row) => {
    const metadata = asRecord(row.metadata);
    const display = metadata.model_display;
    const displayName = asString(display) ?? asString(asRecord(display).label);
    const modelNames = Array.isArray(metadata.model_names)
      ? metadata.model_names.filter((item): item is string => typeof item === "string")
      : [];
    const metrics = asRecord(row.metrics);
    return evidence({
      source: `terminal-bench-${version}`,
      sourceUrl: TERMINAL_BENCH_URL,
      sourceVersion: `Terminal-Bench ${version}`,
      matchedModelId: asString(metadata.model_id),
      matchedModelName: displayName ?? modelNames[0] ?? asString(metadata.model),
      benchmark: "Terminal-Bench",
      benchmarkVersion: version,
      reasoningEffort: asString(metadata.reasoning_effort),
      reasoningConfig: metadata.config ?? null,
      metric: asFiniteNumber(metrics.accuracy) !== null ? "accuracy" : null,
      value: asFiniteNumber(metrics.accuracy),
      sourceDate: asString(metadata.date) ?? asString(row.updated_at),
      verificationStatus: "official_leaderboard",
      raw: row,
    });
  });
}

function parseSweEvidence(data: unknown): ParsedEvidence[] {
  const leaderboards = asRows(asRecord(data).leaderboards);
  const rows: ParsedEvidence[] = [];
  for (const leaderboard of leaderboards) {
    const groupName = asString(leaderboard.name);
    for (const row of asRows(leaderboard.results)) {
      const modelName = asString(row.model_display) ?? asString(row.name);
      rows.push(
        evidence({
          source: "swe-bench",
          sourceUrl: SWE_BENCH_URL,
          sourceVersion: groupName ? `SWE-bench ${groupName}` : "SWE-bench leaderboard",
          matchedModelId: asString(row.model_id),
          matchedModelName: modelName,
          benchmark: "SWE-bench",
          benchmarkVersion: groupName,
          reasoningEffort: asString(row.reasoning_effort),
          reasoningConfig: row.config ?? null,
          metric: asFiniteNumber(row.resolved) !== null ? "resolved" : null,
          value: asFiniteNumber(row.resolved),
          sourceDate: asString(row.date),
          verificationStatus: "official_leaderboard",
          raw: row,
        })
      );
    }
  }
  return rows;
}

async function loadAAFreeSnapshot(fetchImpl: typeof fetch): Promise<SourceSnapshot> {
  const apiKey = process.env.AA_API_KEY;
  if (!apiKey) {
    return {
      ...sourceReceipt(
        "error",
        AA_FREE_URL,
        null,
        null,
        null,
        [],
        "AA Free API key is not configured"
      ),
      allRows: [],
    };
  }

  const sourceRows: JsonRecord[] = [];
  let version: string | null = null;
  let lastDate: string | null = null;
  let lastRaw: unknown = null;
  try {
    for (let page = 1; page <= MAX_AA_PAGES; page++) {
      const url = `${AA_FREE_URL}?page=${page}`;
      const { data, response } = await fetchJson(
        url,
        { headers: { "x-api-key": apiKey } },
        fetchImpl
      );
      const root = asRecord(data);
      const pagination = asRecord(root.pagination);
      if (!Array.isArray(root.data) || typeof pagination.has_more !== "boolean") {
        throw new Error("Invalid AA Free response shape");
      }
      sourceRows.push(...asRows(root.data));
      version =
        typeof root.intelligence_index_version === "number"
          ? `Artificial Analysis Free index v${root.intelligence_index_version}`
          : "Artificial Analysis Free";
      lastDate = responseDate(response);
      lastRaw = data;
      if (!pagination.has_more) break;
      if (page === MAX_AA_PAGES) {
        const allRows = parseAAEvidence(sourceRows, version, lastDate);
        return {
          ...sourceReceipt(
            "incomplete",
            AA_FREE_URL,
            sourceRows,
            version,
            lastDate,
            [],
            "AA Free page limit reached"
          ),
          allRows,
        };
      }
    }
    const allRows = parseAAEvidence(sourceRows, version, lastDate);
    return {
      ...sourceReceipt(
        allRows.length ? "found" : "missing",
        AA_FREE_URL,
        sourceRows,
        version,
        lastDate,
        []
      ),
      allRows,
    };
  } catch (error) {
    return {
      ...sourceReceipt("error", AA_FREE_URL, lastRaw, version, lastDate, [], errorMessage(error)),
      allRows: [],
    };
  }
}

function parseAAEvidence(
  rows: JsonRecord[],
  version: string | null,
  defaultDate: string | null
): ParsedEvidence[] {
  const output: ParsedEvidence[] = [];
  for (const row of rows) {
    const slug = asString(row.slug);
    const name = asString(row.name);
    if (!slug && !name) continue;
    const evaluations = asRecord(row.evaluations);
    const shared = {
      source: "artificial-analysis-free",
      sourceUrl: AA_FREE_URL,
      sourceVersion: version,
      matchedModelId: slug,
      matchedModelName: name,
      benchmarkVersion: version,
      reasoningEffort: aaReasoningEffort(name),
      sourceDate: asString(row.release_date) ?? defaultDate,
      verificationStatus: "source_verified",
      raw: row,
    } as const;
    output.push(
      evidence({
        ...shared,
        benchmark: "AA Coding",
        metric: "artificial_analysis_coding_index",
        value: asFiniteNumber(evaluations.artificial_analysis_coding_index),
      }),
      evidence({
        ...shared,
        benchmark: "AA Intelligence",
        metric: "artificial_analysis_intelligence_index",
        value: asFiniteNumber(evaluations.artificial_analysis_intelligence_index),
      })
    );
  }
  return output;
}

async function loadOfficialSourceSnapshot(
  name: OfficialSourceName,
  fetchImpl: typeof fetch
): Promise<SourceSnapshot> {
  const request = sourceRequest(name);
  try {
    const { data, response } = await fetchJson(request.url, request.init, fetchImpl);
    const root = asRecord(data);
    if (
      (name === "swe-bench" &&
        (!Array.isArray(root.leaderboards) ||
          asRows(root.leaderboards).some((entry) => !Array.isArray(asRecord(entry).results)))) ||
      (name !== "swe-bench" && !Array.isArray(root.rows))
    ) {
      throw new Error("Invalid official leaderboard response shape");
    }
    let parsed: ParsedEvidence[];
    switch (name) {
      case "swe-bench":
        parsed = parseSweEvidence(data);
        break;
      case "terminal-bench-2.0":
        parsed = parseTerminalEvidence(data, "2.0");
        break;
      case "terminal-bench-2.1":
        parsed = parseTerminalEvidence(data, "2.1");
        break;
      case "deepswe":
        parsed = parseDeepSweEvidence(data);
        break;
    }
    const version = sourceVersion(name);
    const responseHash = hash(data);
    return {
      status: parsed.length ? "found" : "missing",
      sourceUrl: request.url,
      sourceVersion: version,
      sourceDate: responseDate(response),
      responseHash,
      allRows: parsed,
    };
  } catch (error) {
    return {
      ...sourceReceipt("error", request.url, null, null, null, [], errorMessage(error)),
      allRows: [],
    };
  }
}

async function loadBenchmarkSourceSnapshot(
  fetchImpl: typeof fetch
): Promise<BenchmarkSourceSnapshot> {
  const [aa, sweBench, terminal20, terminal21, deepswe] = await Promise.all([
    loadAAFreeSnapshot(fetchImpl),
    loadOfficialSourceSnapshot("swe-bench", fetchImpl),
    loadOfficialSourceSnapshot("terminal-bench-2.0", fetchImpl),
    loadOfficialSourceSnapshot("terminal-bench-2.1", fetchImpl),
    loadOfficialSourceSnapshot("deepswe", fetchImpl),
  ]);
  return {
    aa,
    official: {
      "swe-bench": sweBench,
      "terminal-bench-2.0": terminal20,
      "terminal-bench-2.1": terminal21,
      deepswe,
    },
  };
}

function getBenchmarkSourceSnapshot(fetchImpl: typeof fetch): Promise<BenchmarkSourceSnapshot> {
  const now = Date.now();
  if (
    sharedSourceSnapshotCache &&
    sharedSourceSnapshotCache.fetchImpl === fetchImpl &&
    now - sharedSourceSnapshotCache.loadedAt < SHARED_SOURCE_CACHE_TTL_MS
  ) {
    return sharedSourceSnapshotCache.promise;
  }
  const promise = loadBenchmarkSourceSnapshot(fetchImpl);
  sharedSourceSnapshotCache = { fetchImpl, loadedAt: now, promise };
  return promise;
}

function matchSnapshotForModel(
  model: ModelIdentity,
  snapshot: SourceSnapshot,
  uniqueName: boolean
): SourceCheck {
  const matches = snapshot.allRows.filter((row) => {
    if (row.matchedModelId && folded(row.matchedModelId) === folded(model.id)) return true;
    if (!uniqueName || !row.matchedModelName) return false;
    return folded(row.matchedModelName) === folded(model.name);
  });
  const status =
    snapshot.status === "error" || snapshot.status === "incomplete"
      ? snapshot.status
      : matches.length
        ? "found"
        : "missing";
  return {
    status,
    sourceUrl: snapshot.sourceUrl,
    sourceVersion: snapshot.sourceVersion,
    sourceDate: snapshot.sourceDate,
    responseHash: snapshot.responseHash,
    matches,
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}

function sourceRequest(name: OfficialSourceName): { url: string; init: RequestInit } {
  if (name === "swe-bench") return { url: SWE_BENCH_URL, init: {} };
  if (name === "deepswe") return { url: DEEP_SWE_URL, init: {} };
  const is21 = name.endsWith("2.1");
  return {
    url: TERMINAL_BENCH_URL,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        package: is21 ? "terminal-bench/terminal-bench-2-1" : "terminal-bench/terminal-bench-2",
        name: is21 ? "main" : "2-0",
      }),
    },
  };
}

function sourceVersion(name: OfficialSourceName): string {
  switch (name) {
    case "swe-bench":
      return "SWE-bench leaderboard JSON";
    case "terminal-bench-2.0":
      return "Terminal-Bench 2.0";
    case "terminal-bench-2.1":
      return "Terminal-Bench 2.1";
    case "deepswe":
      return "DeepSWE v1.1";
  }
}

async function findHuggingFaceEvidence(
  model: ModelIdentity,
  fetchImpl: typeof fetch
): Promise<{ status: SourceStatus; receipt: Record<string, unknown>; evidence: ParsedEvidence[] }> {
  const queries = [
    ...new Set([model.id, model.name].map((value) => value.trim()).filter(Boolean)),
  ].slice(0, 2);
  const matches = new Map<string, JsonRecord>();
  const rawResponses: unknown[] = [];
  try {
    for (const query of queries) {
      const url = new URL(HF_MODELS_URL);
      url.searchParams.set("search", query);
      url.searchParams.set("limit", String(MAX_HF_RESULTS));
      const { data } = await fetchJson(url.toString(), {}, fetchImpl);
      if (!Array.isArray(data)) throw new Error("Invalid Hugging Face model list response");
      rawResponses.push(data);
      for (const result of asRows(data)) {
        const repoId = asString(result.id) ?? asString(result.modelId);
        if (repoId && exactIdentityFields(model, [repoId])) matches.set(repoId, result);
      }
    }

    const found: ParsedEvidence[] = [];
    for (const repoId of [...matches.keys()].slice(0, MAX_HF_RESULTS)) {
      const repoPath = repoId.split("/").map(encodeURIComponent).join("/");
      const url = `https://huggingface.co/api/models/${repoPath}?expand%5B%5D=evalResults`;
      const { data } = await fetchJson(url, {}, fetchImpl);
      const root = asRecord(data);
      const results = Array.isArray(root.evalResults) ? root.evalResults : [];
      for (const item of results) {
        const row = asRecord(item);
        const dataset = asString(row.dataset_id) ?? asString(row.dataset_name);
        found.push(
          evidence({
            source: "huggingface-eval-results",
            sourceUrl: url,
            sourceVersion: "Hugging Face Hub evalResults",
            matchedModelId: asString(root.id) ?? repoId,
            matchedModelName: asString(root.name) ?? repoId,
            benchmark: dataset,
            benchmarkVersion: asString(row.dataset_revision) ?? asString(row.revision),
            reasoningEffort: asString(row.reasoning_effort),
            reasoningConfig: row.reasoning_config ?? null,
            metric: asString(row.metric) ?? (asFiniteNumber(row.value) !== null ? "value" : null),
            value: asFiniteNumber(row.value),
            sourceDate: asString(row.date) ?? asString(root.lastModified),
            verificationStatus:
              row.verified === true ? "source_verified_review_required" : "review_required",
            raw: row,
          })
        );
      }
    }
    return {
      status: found.length ? "found" : "missing",
      receipt: {
        status: found.length ? "found" : "missing",
        sourceUrl: HF_MODELS_URL,
        queries,
        responseHash: hash(rawResponses),
      },
      evidence: found,
    };
  } catch (error) {
    return {
      status: "error",
      receipt: { status: "error", sourceUrl: HF_MODELS_URL, queries, error: errorMessage(error) },
      evidence: [],
    };
  }
}

export function validateOllamaSearchResponse(data: unknown): {
  results: ReturnType<typeof asRows>;
  searchCostUsd: 0;
} {
  const response = asRecord(data);
  if (response.provider !== OLLAMA_SEARCH.provider) {
    throw new Error(`Unexpected search provider: ${String(response.provider)}`);
  }
  const searchCostUsd = asRecord(response.usage).search_cost_usd;
  if (searchCostUsd !== 0) {
    throw new Error(`Unexpected search cost: ${String(searchCostUsd)}`);
  }
  return {
    results: asRows(response.results).slice(0, OLLAMA_SEARCH.maxResults),
    searchCostUsd: 0,
  };
}

async function searchOllama(model: ModelIdentity): Promise<{
  receipt: Record<string, unknown>;
  evidence: ParsedEvidence[];
}> {
  const query = `"${model.id}" benchmark evaluation reasoning effort`;
  const sourceUrl = "https://ollama.com/api/web_search";
  try {
    if (getSearchProvider(OLLAMA_SEARCH.provider)?.costPerQuery !== 0) {
      throw new Error("ollama-search is not configured as zero-cost");
    }
    const { data } = await executeWebSearch({
      query,
      provider: OLLAMA_SEARCH.provider,
      max_results: OLLAMA_SEARCH.maxResults,
      search_type: "web",
    });
    const { results, searchCostUsd } = validateOllamaSearchResponse(data);
    return {
      receipt: {
        status: results.length ? "found" : "missing",
        sourceUrl,
        sourceVersion: "OmniRoute search ollama-search",
        searchCostUsd,
        provider: OLLAMA_SEARCH.provider,
        query,
      },
      evidence: results.map((row) =>
        evidence({
          source: "ollama-search",
          sourceUrl: asString(row.url) ?? sourceUrl,
          sourceVersion: "OmniRoute search ollama-search",
          verificationStatus: "candidate_review_required",
          raw: row,
        })
      ),
    };
  } catch (error) {
    return {
      receipt: {
        status: "error",
        sourceUrl,
        sourceVersion: "OmniRoute search ollama-search",
        query,
        error: errorMessage(error),
      },
      evidence: [],
    };
  }
}

function toEvidenceRows(
  modelId: string,
  rows: ParsedEvidence[]
): ModelBenchmarkSearchEvidenceInput[] {
  const capturedAt = new Date().toISOString();
  return rows.map((row) => {
    const stableContent = {
      modelId,
      source: row.source,
      sourceVersion: row.sourceVersion,
      sourceUrl: row.sourceUrl,
      raw: row.raw,
    };
    return {
      evidenceHash: hash(stableContent),
      modelId,
      source: row.source,
      sourceVersion: row.sourceVersion,
      matchedModelId: row.matchedModelId,
      matchedModelName: row.matchedModelName,
      benchmark: row.benchmark,
      benchmarkVersion: row.benchmarkVersion,
      reasoningEffort: row.reasoningEffort,
      reasoningConfig: row.reasoningConfig,
      metric: row.metric,
      value: row.value,
      sourceUrl: row.sourceUrl,
      sourceDate: row.sourceDate,
      verificationStatus: row.verificationStatus,
      capturedAt,
      raw: row.raw,
    };
  });
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function materializeModelEvidence(
  model: ModelIdentity,
  snapshot: BenchmarkSourceSnapshot
): ModelSourceEvidence {
  const uniqueName = isModelBenchmarkSearchNameUnique(model.name);
  const checks = [
    matchSnapshotForModel(model, snapshot.aa, uniqueName),
    ...Object.values(snapshot.official).map((source) =>
      matchSnapshotForModel(model, source, uniqueName)
    ),
  ];
  const matches = checks.flatMap((source) => source.matches);
  if (matches.length) saveModelBenchmarkSearchEvidence(toEvidenceRows(model.id, matches));

  return {
    checks,
    sourceStatus: Object.fromEntries(
      ["artificialAnalysis", "sweBench", "terminalBench20", "terminalBench21", "deepSwe"].map(
        (key, index) => [key, sourceStatusForStorage(checks[index])]
      )
    ),
  };
}

async function refreshSearchRun(
  run: ModelBenchmarkSearchRun,
  fetchImpl: typeof fetch,
  direct: ModelSourceEvidence,
  directScore: ModelBenchmarkFitness | undefined
): Promise<SearchRunOutcome> {
  const model = { id: run.modelId, name: run.modelName };
  const sourceStatus = { ...direct.sourceStatus };
  sourceStatus.fitness = directScore ?? null;

  if (
    typeof directScore?.codingFitness === "number" ||
    typeof directScore?.generalFitness === "number"
  ) {
    return {
      modelId: model.id,
      normalizationStatus: "not_needed",
      sourceStatus,
      discoveredEvidence: false,
      lastError: null,
    };
  }

  const completeSweep = direct.checks.every(
    (source) => source.status === "found" || source.status === "missing"
  );
  if (!completeSweep) {
    const failed = direct.checks.filter(
      (source) => source.status === "error" || source.status === "incomplete"
    );
    return {
      modelId: model.id,
      normalizationStatus: "not_started",
      sourceStatus,
      discoveredEvidence: false,
      lastError: failed.length
        ? failed.map((source) => source.error || source.status).join("; ")
        : null,
    };
  }
  // AICODE-NOTE: Spend discovery-search quota only after a complete exact miss.
  if (direct.checks.some((source) => source.status === "found")) {
    return {
      modelId: model.id,
      normalizationStatus: "not_needed",
      sourceStatus,
      discoveredEvidence: true,
      lastError: null,
    };
  }

  const [hf, web] = await Promise.all([
    findHuggingFaceEvidence(model, fetchImpl),
    searchOllama(model),
  ]);
  sourceStatus.huggingFace = hf.receipt;
  sourceStatus.ollamaSearch = web.receipt;
  const sourceEvidence = [...hf.evidence, ...web.evidence];
  if (sourceEvidence.length) {
    saveModelBenchmarkSearchEvidence(toEvidenceRows(model.id, sourceEvidence));
  }
  const searchResults = web.evidence.map((item) => {
    const raw = asRecord(item.raw);
    return {
      url: item.sourceUrl,
      title: asString(raw.title) ?? undefined,
      snippet: asString(raw.snippet) ?? undefined,
    };
  });
  const processor = await processModelBenchmarkSearchResults(model, searchResults);
  const { evidence: normalizedCandidates, ...processorReceipt } = processor;
  const normalized = normalizedCandidates.map((item) =>
    evidence({
      source: "ollama-search-structured-output",
      sourceVersion: NORMALIZATION_MODEL,
      matchedModelId: item.matchedModelId,
      matchedModelName: item.matchedModelName,
      reasoningEffort: item.reasoningEffort,
      reasoningConfig: item.reasoningConfig,
      benchmark: item.benchmark,
      benchmarkVersion: item.benchmarkVersion,
      metric: item.metric,
      value: item.value,
      sourceUrl: item.sourceUrl,
      sourceDate: item.sourceDate,
      verificationStatus: "source_verified_review_required",
      raw: item.raw,
    })
  );
  sourceStatus.normalizationProcessor = processorReceipt;
  if (normalized.length) {
    saveModelBenchmarkSearchEvidence(toEvidenceRows(model.id, normalized));
  }
  const discovered = [...sourceEvidence, ...normalized];
  const searchErrors = [
    hf.status === "error" ? asString(hf.receipt.error) : null,
    asString(web.receipt.status) === "error" ? asString(web.receipt.error) : null,
    processor.status === "normalization_timeout_unrated"
      ? (asString(processorReceipt.error) ?? "Strict-SO normalization timed out")
      : null,
  ].filter((error): error is string => error !== null);
  return {
    modelId: model.id,
    normalizationStatus: processor.status,
    sourceStatus,
    discoveredEvidence: discovered.length > 0,
    lastError: searchErrors.length ? searchErrors.join("; ") : null,
  };
}

let drainPromise: Promise<void> | null = null;
let continuationTimer: ReturnType<typeof setTimeout> | null = null;

function toScoreMap(scores: ModelBenchmarkFitness[]): Map<string, ModelBenchmarkFitness> {
  return new Map(scores.map((score) => [score.modelId, score]));
}

function scheduleBenchmarkSearchDrain(delayMs: number): void {
  if (continuationTimer) clearTimeout(continuationTimer);
  continuationTimer = setTimeout(() => {
    continuationTimer = null;
    void drainModelBenchmarkSearchQueue();
  }, delayMs);
  continuationTimer.unref?.();
}

function scheduleBenchmarkSearchContinuation(): void {
  if (hasEligibleModelBenchmarkSearch()) {
    scheduleBenchmarkSearchDrain(CONTINUE_DRAIN_DELAY_MS);
    return;
  }
  const staleRetryDelay = getModelBenchmarkSearchStaleRetryDelay();
  if (staleRetryDelay !== null) scheduleBenchmarkSearchDrain(staleRetryDelay);
}

export function drainModelBenchmarkSearchQueue(): Promise<void> {
  // AICODE-NOTE: Claim and finish each row before the next claim so one slow run cannot strand a whole batch as running.
  if (drainPromise) return drainPromise;
  if (continuationTimer) {
    clearTimeout(continuationTimer);
    continuationTimer = null;
  }
  drainPromise = (async () => {
    try {
      expireExhaustedModelBenchmarkSearchRuns();
      if (!hasEligibleModelBenchmarkSearch()) {
        scheduleBenchmarkSearchContinuation();
        return;
      }

      const snapshot = await getBenchmarkSourceSnapshot(fetch);
      const prepared = new Map<string, ModelSourceEvidence>();
      for (const candidate of listEligibleModelBenchmarkSearchRuns(MAX_MODELS_PER_DRAIN)) {
        prepared.set(
          candidate.modelId,
          materializeModelEvidence({ id: candidate.modelId, name: candidate.modelName }, snapshot)
        );
      }
      let scores = toScoreMap((await recomputeModelBenchmarkFitness()).scores);
      let completed = 0;
      while (completed < MAX_MODELS_PER_DRAIN) {
        const run = claimModelBenchmarkSearch();
        if (!run) break;
        let direct = prepared.get(run.modelId) ?? null;
        let outcome: SearchRunOutcome;
        try {
          if (!direct) {
            direct = materializeModelEvidence({ id: run.modelId, name: run.modelName }, snapshot);
            scores = toScoreMap((await recomputeModelBenchmarkFitness()).scores);
          }
          outcome = await refreshSearchRun(
            run,
            fetch,
            direct,
            scores.get(run.modelId.toLowerCase())
          );
          if (outcome.discoveredEvidence) {
            scores = toScoreMap((await recomputeModelBenchmarkFitness()).scores);
          }
        } catch (error) {
          outcome = {
            modelId: run.modelId,
            normalizationStatus: NORMALIZATION_BLOCK_REASON,
            sourceStatus: { ...direct?.sourceStatus, error: errorMessage(error) },
            discoveredEvidence: false,
            lastError: errorMessage(error),
          };
        }

        const score = scores.get(outcome.modelId.toLowerCase());
        let status: string;
        if (typeof score?.codingFitness === "number" || typeof score?.generalFitness === "number") {
          status = "scored";
        } else if (outcome.discoveredEvidence) {
          status = "review_required";
        } else if (outcome.lastError) {
          status = "source_error";
        } else {
          status = "unrated_no_evidence";
        }
        finishModelBenchmarkSearch({
          modelId: outcome.modelId,
          status,
          normalizationStatus: outcome.normalizationStatus,
          sourceStatus: { ...outcome.sourceStatus, fitness: score ?? null },
          lastError: outcome.lastError,
        });
        completed += 1;
      }
      scheduleBenchmarkSearchContinuation();
    } catch (error) {
      console.error("[MODEL_BENCHMARK_SEARCH] Drain failed:", errorMessage(error).slice(0, 300));
      scheduleBenchmarkSearchContinuation();
    }
  })().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

export function resetModelBenchmarkSearchStateForTests(): void {
  sharedSourceSnapshotCache = null;
  if (continuationTimer) clearTimeout(continuationTimer);
  continuationTimer = null;
  drainPromise = null;
}
