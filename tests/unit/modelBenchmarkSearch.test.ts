import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-model-benchmark-search-"));
process.env.DATA_DIR = TEST_DATA_DIR;
const { DefaultExecutor } = await import("../../open-sse/executors/default.ts");
const chatHelpers = await import("../../src/sse/handlers/chatHelpers.ts");
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const modelIntelligenceDb = await import("../../src/lib/db/modelIntelligence.ts");
const modelsDevSync = await import("../../src/lib/modelsDevSync.ts");
const modelCapabilities = await import("../../src/lib/modelCapabilities.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const fitnessSync = await import("../../src/lib/modelBenchmarkFitnessSync.ts");
const taskFitness = await import("../../open-sse/services/autoCombo/taskFitness.ts");
const tierResolver = await import("../../open-sse/services/tierResolver.ts");
const { buildAutoCandidateFilter } =
  await import("../../open-sse/services/autoCombo/suffixComposition.ts");
const searchDb = await import("../../src/lib/db/modelBenchmarkSearch.ts");
const processor = await import("../../src/lib/modelBenchmarkSearchProcessor.ts");
const search = await import("../../src/lib/modelBenchmarkSearch.ts");
const searchRegistry = await import("../../open-sse/config/searchRegistry.ts");

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  process.env.DATA_DIR = TEST_DATA_DIR;
}

function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", date: "Mon, 26 Oct 2026 00:00:00 GMT" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function waitFor(predicate: () => unknown, timeoutMs = 2_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

async function addActiveCatalogModels(models: Array<{ id: string; name: string }>) {
  const connection = (await providersDb.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "benchmark-active-catalog-test",
    apiKey: "benchmark-active-catalog-test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  })) as { id: string };
  await modelsDb.replaceSyncedAvailableModelsForConnection("openai", connection.id, models);
}

function insertLegacyAaCodingEvidence(
  modelId: string,
  raw: Record<string, unknown>,
  value: number | null
) {
  const sourceVersion = "Artificial Analysis Free index v4.1";
  const sourceUrl = "https://artificialanalysis.ai/api/v2/language/models/free";
  const modelName = typeof raw.name === "string" ? raw.name : null;
  const sourceDate = typeof raw.release_date === "string" ? raw.release_date : null;
  searchDb.replaceModelBenchmarkEvidenceSources([
    {
      modelId,
      source: "artificial-analysis-free",
      rows: [
        {
          evidenceHash: `legacy-${modelId}`,
          modelId,
          source: "artificial-analysis-free",
          sourceVersion,
          matchedModelId: modelId,
          matchedModelName: modelName,
          benchmark: "AA Coding",
          benchmarkVersion: sourceVersion,
          reasoningEffort: "high",
          reasoningConfig: null,
          metric: "artificial_analysis_coding_index",
          value,
          sourceUrl,
          sourceDate,
          verificationStatus: "source_verified",
          capturedAt: new Date().toISOString(),
        },
      ],
    },
  ]);
}

test.beforeEach(() => {
  resetStorage();
  search.resetModelBenchmarkSearchStateForTests();
  globalThis.fetch = originalFetch;
  restoreEnv();
  delete process.env.AA_API_KEY;
});

test.afterEach(() => {
  search.resetModelBenchmarkSearchStateForTests();
  globalThis.fetch = originalFetch;
  restoreEnv();
  core.resetDbInstance();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("model identity matching trims and case-folds, but keeps variants distinct", () => {
  const model = { id: "vendor/model-x-high", name: "Model X High" };

  assert.equal(search.exactModelMatch(model, [" VENDOR/MODEL-X-HIGH "]), true);
  assert.equal(search.exactModelMatch(model, ["Model X High"]), true);
  assert.equal(search.exactModelMatch(model, ["vendor/model-x"]), false);
  assert.equal(search.exactModelMatch(model, ["vendor/model-x-high (high)"]), false);
});

test("a negative result needs a complete AA scan and every official source", () => {
  const missing = {
    aa: "missing",
    official: ["missing", "missing", "missing", "missing"],
  } as const;

  assert.equal(search.isCompleteMissingFromKnownLeaderboards(missing), true);
  assert.equal(search.isCompleteMissingFromKnownLeaderboards({ ...missing, aa: "error" }), false);
  assert.equal(
    search.isCompleteMissingFromKnownLeaderboards({
      ...missing,
      official: ["missing", "missing", "incomplete", "missing"],
    }),
    false
  );
  assert.equal(
    search.isCompleteMissingFromKnownLeaderboards({
      ...missing,
      official: ["found", "missing", "missing", "missing"],
    }),
    false
  );
});

test("DeepSWE evidence keeps exact effort/config and leaves absent values null", () => {
  const rows = search.parseDeepSweEvidence({
    generated_at: "2026-10-26T00:00:00Z",
    rows: [
      {
        model: "vendor/model-x",
        reasoning_effort: "high",
        config: "harness-high",
        pass_rate: 0.61,
      },
      { model: "vendor/model-y", pass_rate: null },
    ],
  });

  assert.equal(rows[0].reasoningEffort, "high");
  assert.equal(rows[0].reasoningConfig, "harness-high");
  assert.equal(rows[0].metric, "pass_rate");
  assert.equal(rows[0].value, 0.61);
  assert.equal(rows[1].reasoningEffort, null);
  assert.equal(rows[1].reasoningConfig, null);
  assert.equal(rows[1].value, null);
});

test("Terminal-Bench evidence preserves declared effort and metric only", () => {
  const rows = search.parseTerminalEvidence(
    {
      rows: [
        {
          metadata: {
            model_display: { label: "Model X" },
            reasoning_effort: "medium",
          },
          metrics: { accuracy: 0.7 },
        },
      ],
    },
    "2.1"
  );

  assert.equal(rows[0].benchmark, "Terminal-Bench");
  assert.equal(rows[0].benchmarkVersion, "2.1");
  assert.equal(rows[0].reasoningEffort, "medium");
  assert.equal(rows[0].value, 0.7);
  assert.equal(rows[0].reasoningConfig, null);
});

test("web search selects configured zero-cost Ollama Search", () => {
  assert.deepEqual(search.OLLAMA_SEARCH, {
    provider: "ollama-search",
    maxResults: 10,
  });
  assert.equal(searchRegistry.getSearchProvider("ollama-search")?.costPerQuery, 0);
});

test("web search rejects a substituted provider or nonzero response cost", () => {
  const response = {
    provider: "ollama-search",
    results: [{ url: "https://example.org/eval" }],
    usage: { search_cost_usd: 0 },
  };

  assert.throws(
    () => search.validateOllamaSearchResponse({ ...response, provider: "tavily" }),
    /Unexpected search provider/
  );
  assert.throws(
    () => search.validateOllamaSearchResponse({ ...response, usage: { search_cost_usd: 0.01 } }),
    /Unexpected search cost/
  );
});

test("web search stops before calling Ollama when registry cost is nonzero", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-test",
    apiKey: "ollama-search-test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  await addActiveCatalogModels([{ id: "cost-change-model", name: "Cost Change Model" }]);
  const provider = searchRegistry.getSearchProvider("ollama-search");
  assert.ok(provider);
  const originalCost = provider.costPerQuery;
  const urls: string[] = [];
  provider.costPerQuery = 0.001;
  globalThis.fetch = async (input, _init) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        tier: "free",
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) return jsonResponse([]);
    if (url === "https://ollama.com/api/web_search") {
      return jsonResponse({ results: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    searchDb.enqueueModelBenchmarkSearches([
      { id: "cost-change-model", name: "Cost Change Model" },
    ]);
    await search.drainModelBenchmarkSearchQueue();

    const [run] = searchDb.listModelBenchmarkSearchRuns();
    assert.equal(run.sourceStatus.ollamaSearch.status, "error");
    assert.match(run.sourceStatus.ollamaSearch.error, /zero.cost/i);
    assert.equal(urls.includes("https://ollama.com/api/web_search"), false);
    assert.equal(
      urls.some((url) => url.includes("openrouter.ai/api/v1/chat/completions")),
      false
    );
  } finally {
    provider.costPerQuery = originalCost;
  }
});

test("queued search failure records an error without storing results or calling strict-SO", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-test",
    apiKey: "ollama-search-test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  await addActiveCatalogModels([{ id: "search-error-model", name: "Search Error Model" }]);
  const urls: string[] = [];
  const unexpectedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        tier: "free",
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) return jsonResponse([]);
    if (url === "https://ollama.com/api/web_search") return jsonResponse({}, 503);
    unexpectedUrls.push(url);
    throw new Error(`Unexpected request: ${url}`);
  };

  searchDb.enqueueModelBenchmarkSearches([
    { id: "search-error-model", name: "Search Error Model" },
  ]);
  await search.drainModelBenchmarkSearchQueue();

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "source_error");
  assert.equal(run.sourceStatus.ollamaSearch.status, "error");
  assert.equal(searchDb.listModelBenchmarkSearchEvidence("search-error-model").length, 0);
  assert.deepEqual(unexpectedUrls, []);
  assert.equal(
    urls.some((url) => url.includes("openrouter.ai/api/v1/chat/completions")),
    false
  );
});

test("Ollama Search 429 defers whole queue before strict-SO dispatch", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-rate-limit-test",
    apiKey: "ollama-search-rate-limit-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  await addActiveCatalogModels([
    { id: "a-search-rate-limited", name: "Search Rate Limited" },
    { id: "z-search-peer", name: "Search Peer" },
  ]);
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        tier: "free",
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) return jsonResponse([]);
    if (url === "https://ollama.com/api/web_search") {
      return new Response("{}", {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "120",
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  searchDb.enqueueModelBenchmarkSearches([
    { id: "a-search-rate-limited", name: "Search Rate Limited" },
    { id: "z-search-peer", name: "Search Peer" },
  ]);
  await search.drainModelBenchmarkSearchQueue();
  const completedAt = Date.now();

  const runs = searchDb.listModelBenchmarkSearchRuns();
  const limited = runs.find((run) => run.modelId === "a-search-rate-limited");
  assert.equal(limited?.status, "source_error");
  assert.equal((limited?.sourceStatus.ollamaSearch as { statusCode?: number }).statusCode, 429);
  assert.equal((limited?.sourceStatus.ollamaSearch as { rawError?: string }).rawError, "{}");
  assert.equal((limited?.sourceStatus.ollamaSearch as { retryAfter?: string }).retryAfter, "120");
  assert.equal(limited?.attempts, 1);
  assert.ok(limited?.retryAfterAt);
  assert.ok(Date.parse(limited.retryAfterAt) >= completedAt + 119_000);
  assert.ok(Date.parse(limited.retryAfterAt) <= completedAt + 121_000);
  assert.equal(runs.find((run) => run.modelId === "z-search-peer")?.status, "pending");
  assert.equal(searchDb.hasEligibleModelBenchmarkSearch(), false);
  assert.equal(
    urls.some((url) => url.includes("openrouter.ai/api/v1/chat/completions")),
    false
  );
});

test("exact Ollama Search no-credentials error defers without trying another route", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await addActiveCatalogModels([{ id: "search-no-credentials", name: "Search No Credentials" }]);
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        tier: "free",
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) return jsonResponse([]);
    throw new Error(`Unexpected request: ${url}`);
  };

  searchDb.enqueueModelBenchmarkSearches([
    { id: "search-no-credentials", name: "Search No Credentials" },
  ]);
  await search.drainModelBenchmarkSearchQueue();

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.match(
    String(run.sourceStatus.ollamaSearch.error),
    /^No credentials configured for search provider: ollama-search\./
  );
  assert.equal(run.attempts, 0);
  assert.ok(run.retryAfterAt && Date.parse(run.retryAfterAt) > Date.now());
  assert.ok(Date.parse(run.retryAfterAt) < Date.now() + 15 * 60_000 + 1_000);
  assert.equal(
    urls.some((url) => url.includes("openrouter.ai/api/v1/chat/completions")),
    false
  );
});

test("repeated Ollama Search 429s stop at the attempt limit and keep candidates unrated", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-repeated-rate-limit-test",
    apiKey: "ollama-search-repeated-rate-limit-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  await addActiveCatalogModels([{ id: "repeated-429-model", name: "Repeated 429 Model" }]);
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let searchCalls = 0;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    if ((delay ?? 0) >= 14_000 && (delay ?? 0) < 60_000) queueMicrotask(callback);
    return { unref() {} } as ReturnType<typeof setTimeout>;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof globalThis.clearTimeout;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        tier: "free",
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?"))
      return jsonResponse([{ id: "repeated-429-model" }]);
    if (url.startsWith("https://huggingface.co/api/models/repeated-429-model?")) {
      return jsonResponse({ id: "repeated-429-model", evalResults: [{ dataset_id: "SWE-bench" }] });
    }
    if (url === "https://ollama.com/api/web_search") {
      searchCalls += 1;
      return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    searchDb.enqueueModelBenchmarkSearches([
      { id: "repeated-429-model", name: "Repeated 429 Model" },
    ]);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await search.drainModelBenchmarkSearchQueue();
      if (attempt < 4) {
        core
          .getDbInstance()
          .prepare(
            "UPDATE provider_connections SET rate_limited_until = NULL, test_status = 'active' WHERE provider = 'ollama-cloud'"
          )
          .run();
        core
          .getDbInstance()
          .prepare("UPDATE model_benchmark_search_models SET retry_after_at = ? WHERE model_id = ?")
          .run(new Date(Date.now() - 1_000).toISOString(), "repeated-429-model");
      }
    }
    await search.drainModelBenchmarkSearchQueue();

    const [run] = searchDb.listModelBenchmarkSearchRuns();
    assert.equal(searchCalls, 5);
    assert.equal(run.attempts, 5);
    assert.equal(run.status, "review_required");
    assert.ok(searchDb.listModelBenchmarkSearchEvidence("repeated-429-model").length > 0);
    assert.equal(run.sourceStatus.ollamaSearch.statusCode, 429);
    assert.equal(run.sourceStatus.fitness.codingFitness, null);
    assert.equal(run.sourceStatus.fitness.generalFitness, null);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("fitness refresh failure preserves a deferred retry and its source receipt", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-fitness-failure-test",
    apiKey: "ollama-search-fitness-failure-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  await addActiveCatalogModels([
    { id: "fitness-seed-model", name: "Fitness Seed Model" },
    { id: "fitness-failure-model", name: "Fitness Failure Model" },
  ]);
  searchDb.enqueueModelBenchmarkSearches([
    { id: "fitness-seed-model", name: "Fitness Seed Model" },
    { id: "fitness-failure-model", name: "Fitness Failure Model" },
  ]);
  searchDb.saveModelBenchmarkSearchEvidence([
    {
      evidenceHash: "fitness-seed-evidence",
      modelId: "fitness-seed-model",
      source: "artificial-analysis-free",
      sourceVersion: "test",
      matchedModelId: "fitness-seed-model",
      matchedModelName: "Fitness Seed Model",
      benchmark: "Artificial Analysis Coding Index",
      benchmarkVersion: null,
      reasoningEffort: null,
      reasoningConfig: null,
      metric: "artificial_analysis_coding_index",
      value: 40,
      sourceUrl: "https://artificialanalysis.ai/test",
      sourceDate: null,
      verificationStatus: "verified",
      capturedAt: new Date().toISOString(),
    },
  ]);
  const urls: string[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    if ((delay ?? 0) >= 14_000 && (delay ?? 0) < 60_000) queueMicrotask(callback);
    return { unref() {} } as ReturnType<typeof setTimeout>;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof globalThis.clearTimeout;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        tier: "free",
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?"))
      return jsonResponse([{ id: "fitness-failure-model" }]);
    if (url.startsWith("https://huggingface.co/api/models/fitness-failure-model?")) {
      return jsonResponse({
        id: "fitness-failure-model",
        evalResults: [{ dataset_id: "SWE-bench" }],
      });
    }
    if (url === "https://ollama.com/api/web_search") {
      core.getDbInstance().exec(`CREATE TRIGGER fail_benchmark_fitness_after_evidence
          BEFORE INSERT ON model_intelligence
          WHEN NEW.source = 'benchmark_fitness'
          BEGIN SELECT RAISE(ABORT, 'test fitness refresh failure'); END`);
      return new Response("{}", { status: 429, headers: { "retry-after": "120" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await search.drainModelBenchmarkSearchQueue();

    const [run] = searchDb.listModelBenchmarkSearchRuns();
    assert.equal(run.status, "review_required");
    assert.equal(run.attempts, 1);
    assert.ok(run.retryAfterAt && Date.parse(run.retryAfterAt) > Date.now());
    assert.equal(run.sourceStatus.ollamaSearch.statusCode, 429);
    assert.ok(searchDb.listModelBenchmarkSearchEvidence("fitness-failure-model").length > 0);
    assert.equal(
      urls.some((url) => url.includes("openrouter.ai/api/v1/chat/completions")),
      false
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("normalization request uses Auto channel with strict schema and high reasoning", () => {
  const searchResults = [{ url: "https://example.org/report", title: "New Model benchmark" }];
  const body = processor.buildNormalizationRequest("new-model", "New Model", searchResults);

  assert.equal(body.model, processor.NORMALIZATION_MODEL);
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.match(
    messages[0].content,
    /copy evidence_quote as an exact, contiguous, verbatim substring from the selected result title or snippet/i
  );
  assert.deepEqual(JSON.parse(messages[1].content), {
    model_id: "new-model",
    model_name: "New Model",
    search_results: searchResults,
  });
  assert.equal(body.reasoning_effort, "high");
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: {
      name: "benchmark_evidence",
      strict: true,
      schema: processor.NORMALIZATION_SCHEMA,
    },
  });
  assert.equal(body.stream, false);
});

test("strict-SO normalization uses high-band free Auto through ordinary chat", () => {
  const body = processor.buildNormalizationRequest("new-model", "New Model", []);
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/lib/modelBenchmarkSearchProcessor.ts"),
    "utf8"
  );

  assert.equal(body.model, "auto/general_high_so:free");
  assert.equal(processor.NORMALIZATION_TIMEOUT_MS, 20 * 60 * 1000);
  assert.equal(body.reasoning_effort, "high");
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: {
      name: "benchmark_evidence",
      strict: true,
      schema: processor.NORMALIZATION_SCHEMA,
    },
  });
  const processorBody = source.slice(
    source.indexOf("export async function processModelBenchmarkSearchResults")
  );
  assert.doesNotMatch(source, /handleOneShotBenchmarkChat|x-omniroute-connection/);
  assert.match(source, /\bhandleChat\(request, null, body, "model-benchmark-search"\)/);
  assert.equal([...processorBody.matchAll(/\bhandleChat\(/g)].length, 1);
  assert.match(processorBody, /parseNormalizationRetryAfter\(response\.headers\)/);
  assert.match(processorBody, /response\.status === 429 \|\| response\.status === 504/);
});

test("normalization blocks before provider dispatch when Auto bands are disabled", async () => {
  process.env.OMNIROUTE_AUTO_BANDS = "0";
  await settingsDb.updateSettings({ freeAccessPolicy: "strict" });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Provider call must not happen");
  };

  const result = await processor.processModelBenchmarkSearchResults(
    { id: "model-a", name: "Model A" },
    [{ url: "https://example.org/report", title: "Benchmark" }]
  );

  assert.equal(result.status, "blocked_strict_free_auto_route_unavailable");
  assert.match(result.error ?? "", /Auto bands must be enabled/);
  assert.equal(providerCalls, 0);
});

test("normalization blocks before provider dispatch unless free access policy is strict", async () => {
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  await settingsDb.updateSettings({ freeAccessPolicy: "off" });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Provider call must not happen");
  };

  const result = await processor.processModelBenchmarkSearchResults(
    { id: "model-a", name: "Model A" },
    [{ url: "https://example.org/report", title: "Benchmark" }]
  );

  assert.equal(result.status, "blocked_strict_free_auto_route_unavailable");
  assert.match(result.error ?? "", /freeAccessPolicy must be strict/);
  assert.equal(providerCalls, 0);
});

test("429 retry delay prefers Retry-After then reset header and falls back conservatively", () => {
  const now = Date.parse("2026-10-26T00:00:00.000Z");
  assert.equal(
    processor.parseNormalizationRetryAfter(
      new Headers({ "retry-after": "120", "x-ratelimit-reset": "1792974000" }),
      now
    ),
    new Date(now + 120_000).toISOString()
  );
  assert.equal(
    processor.parseNormalizationRetryAfter(new Headers({ "x-ratelimit-reset": "1792974000" }), now),
    new Date(1_792_974_000_000).toISOString()
  );
  assert.equal(
    processor.parseNormalizationRetryAfter(new Headers({ "retry-after": "not-a-date" }), now),
    new Date(now + 15 * 60_000).toISOString()
  );
  assert.equal(
    processor.parseNormalizationRetryAfter(
      new Headers({ "retry-after": "Mon, 26 Oct 2026 00:02:00 GMT" }),
      now
    ),
    "2026-10-26T00:02:00.000Z"
  );
  assert.equal(
    processor.parseNormalizationRetryAfter(
      new Headers({ "x-ratelimit-reset": "2026-10-26T00:03:00.000Z" }),
      now
    ),
    "2026-10-26T00:03:00.000Z"
  );
  assert.equal(
    processor.parseNormalizationRetryAfter(new Headers({ "retry-after": "1e100" }), now),
    new Date(now + 15 * 60_000).toISOString()
  );
  assert.equal(
    processor.parseNormalizationRetryAfter(new Headers({ "x-ratelimit-reset": "1" }), now),
    new Date(now + 15 * 60_000).toISOString()
  );
});

test("no-credentials deferral persists, pauses all claims, and consumes no attempt", () => {
  searchDb.enqueueModelBenchmarkSearches([
    { id: "a-rate-limited-model", name: "Rate Limited Model" },
    { id: "z-queued-peer", name: "Queued Peer" },
  ]);
  const claimed = searchDb.claimModelBenchmarkSearch();
  assert.equal(claimed?.modelId, "a-rate-limited-model");
  const retryAfterAt = new Date(Date.now() + 15 * 60_000).toISOString();
  searchDb.finishModelBenchmarkSearch({
    modelId: "a-rate-limited-model",
    status: "review_required",
    normalizationStatus: "normalization_request_failed_unrated",
    sourceStatus: {
      ollamaSearch: { error: "No credentials configured for search provider: ollama-search" },
    },
    lastError: "No credentials configured for search provider: ollama-search",
    retryAfterAt,
    consumeAttempt: false,
  });

  const runs = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(runs.find((run) => run.modelId === "a-rate-limited-model")?.attempts, 0);
  assert.equal(
    runs.find((run) => run.modelId === "a-rate-limited-model")?.retryAfterAt,
    retryAfterAt
  );
  assert.equal(searchDb.hasEligibleModelBenchmarkSearch(), false);
  assert.equal(searchDb.claimModelBenchmarkSearch(), null);
  assert.ok((searchDb.getModelBenchmarkSearchRetryDelay() ?? 0) > 0);
  core
    .getDbInstance()
    .prepare("UPDATE model_benchmark_search_models SET retry_after_at = ? WHERE model_id = ?")
    .run(new Date(Date.now() - 1_000).toISOString(), "a-rate-limited-model");
  assert.equal(searchDb.claimModelBenchmarkSearch()?.modelId, "a-rate-limited-model");
  assert.equal(searchDb.listModelBenchmarkSearchRuns()[0].attempts, 1);
});

test("a strict-SO HTTP 429 keeps its provider attempt counted during cooldown", () => {
  searchDb.enqueueModelBenchmarkSearches([{ id: "strict-so-429", name: "Strict SO 429" }]);
  searchDb.claimModelBenchmarkSearch();
  const retryAfterAt = new Date(Date.now() + 15 * 60_000).toISOString();
  searchDb.finishModelBenchmarkSearch({
    modelId: "strict-so-429",
    status: "review_required",
    normalizationStatus: "normalization_request_failed_unrated",
    sourceStatus: { normalizationProcessor: { error: "HTTP 429" } },
    lastError: "HTTP 429",
    retryAfterAt,
  });

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.attempts, 1);
  assert.equal(run.retryAfterAt, retryAfterAt);
  assert.equal(searchDb.claimModelBenchmarkSearch(), null);
});

test("long retry timers clamp each leg and recalculate the remaining cooldown", async () => {
  searchDb.enqueueModelBenchmarkSearches([{ id: "long-cooldown-model", name: "Long Cooldown" }]);
  searchDb.claimModelBenchmarkSearch();
  const retryAfterAt = new Date(Date.now() + 3_000_000_000_000).toISOString();
  searchDb.finishModelBenchmarkSearch({
    modelId: "long-cooldown-model",
    status: "review_required",
    normalizationStatus: "normalization_request_failed_unrated",
    sourceStatus: { normalizationProcessor: { error: "HTTP 429" } },
    retryAfterAt,
  });

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled: Array<{ callback: (...args: unknown[]) => void; delay: number }> = [];
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    scheduled.push({ callback, delay: delay ?? 0 });
    return { unref() {} } as ReturnType<typeof setTimeout>;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof globalThis.clearTimeout;
  try {
    await search.drainModelBenchmarkSearchQueue();
    assert.equal(scheduled[0]?.delay, 2_147_483_647);
    core
      .getDbInstance()
      .prepare("UPDATE model_benchmark_search_models SET retry_after_at = ? WHERE model_id = ?")
      .run(new Date(Date.now() + 5_000).toISOString(), "long-cooldown-model");
    scheduled[0].callback();
    await waitFor(() => scheduled.length > 1);
    assert.ok(scheduled[1].delay >= 4_000 && scheduled[1].delay <= 5_000);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("normalization resolves to Auto and preserves strict schema controls", async () => {
  const request = processor.buildNormalizationRequest("new-model", "New Model", []);
  const route = await chatHelpers.resolveModelOrError(String(request.model), { stream: false });
  assert.equal(route.provider, "auto");
  assert.equal(route.model, "general_high_so:free");

  const transformed = new DefaultExecutor(route.provider).transformRequest(
    route.model,
    { ...request, model: route.model },
    false,
    {}
  );

  assert.deepEqual(transformed.response_format, request.response_format);
  assert.deepEqual(transformed.provider, request.provider);
  assert.equal(transformed.model, "general_high_so:free");
});

test("normalization accepts only exact quoted fields and returned source URLs", () => {
  const model = { id: "new-model", name: "New Model" };
  const searchResults = [
    {
      url: "https://example.org/eval",
      title: "New Model on SWE-bench Verified",
      snippet: "New Model pass rate 45% on SWE-bench Verified on 2026-10-20.",
    },
  ];
  const response = {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            results: [
              {
                model_id: "new-model",
                model_name: "New Model",
                reasoning_effort: null,
                reasoning_config: null,
                benchmark: "SWE-bench Verified",
                benchmark_version: "Verified",
                metric: "pass_rate",
                value: 45,
                source_url: "https://example.org/eval",
                source_date: "2026-10-20",
                evidence_quote: searchResults[0].snippet,
              },
            ],
          }),
        },
      },
    ],
  };

  const parsed = processor.parseNormalizationResponse(response, model, searchResults);
  assert.equal(parsed.evidence[0].value, 45);
  assert.equal(parsed.evidence[0].benchmark, "SWE-bench Verified");
  const responseWithQuote = (evidenceQuote: string) => ({
    ...response,
    choices: [
      {
        ...response.choices[0],
        message: {
          content: response.choices[0].message.content.replace(
            JSON.stringify(searchResults[0].snippet),
            JSON.stringify(evidenceQuote)
          ),
        },
      },
    ],
  });
  const invalidQuote = processor.parseNormalizationResponse(
    responseWithQuote("New Model pass rate: 45% on SWE-bench Verified on 2026-10-20."),
    model,
    searchResults
  );
  assert.equal(invalidQuote.evidence.length, 0);
  assert.ok(invalidQuote.rejectedRows[0].reasonCodes.includes("quote_not_verbatim"));

  const invalidUrl = processor.parseNormalizationResponse(
    {
      ...response,
      choices: [
        {
          ...response.choices[0],
          message: {
            content: response.choices[0].message.content.replace(
              "https://example.org/eval",
              "https://example.org/other"
            ),
          },
        },
      ],
    },
    model,
    searchResults
  );
  assert.ok(invalidUrl.rejectedRows[0].reasonCodes.includes("source_url_not_found"));

  const invalidModel = processor.parseNormalizationResponse(
    {
      ...response,
      choices: [
        {
          ...response.choices[0],
          message: {
            content: response.choices[0].message.content.replace("new-model", "other-model"),
          },
        },
      ],
    },
    model,
    searchResults
  );
  assert.ok(invalidModel.rejectedRows[0].reasonCodes.includes("model_identity_mismatch"));

  const invalidNumber = processor.parseNormalizationResponse(
    {
      ...response,
      choices: [
        {
          ...response.choices[0],
          message: {
            content: response.choices[0].message.content.replace('"value":45', '"value":1e999'),
          },
        },
      ],
    },
    model,
    searchResults
  );
  assert.ok(invalidNumber.rejectedRows[0].reasonCodes.includes("invalid_number"));
});

test("normalization reports envelope failures and row rejection counts", () => {
  const model = { id: "new-model", name: "New Model" };
  const searchResults = [{ url: "https://example.org/eval", snippet: "New Model SWE-bench" }];
  const envelope = (finishReason: string, content: string) => ({
    choices: [{ finish_reason: finishReason, message: { content } }],
  });

  assert.equal(
    processor.parseNormalizationResponse(
      { choices: [{ finish_reason: "stop", message: {} }] },
      model,
      searchResults
    ).envelopeError,
    "missing_content"
  );
  assert.equal(
    processor.parseNormalizationResponse(envelope("length", "{}"), model, searchResults)
      .envelopeError,
    "finish_reason_not_stop"
  );
  assert.equal(
    processor.parseNormalizationResponse(envelope("stop", "{"), model, searchResults).envelopeError,
    "malformed_json"
  );

  const allRejected = processor.parseNormalizationResponse(
    envelope(
      "stop",
      JSON.stringify({
        results: [
          {
            model_id: "wrong",
            model_name: "New Model",
            reasoning_effort: null,
            reasoning_config: null,
            benchmark: null,
            benchmark_version: null,
            metric: null,
            value: null,
            source_url: searchResults[0].url,
            source_date: null,
            evidence_quote: "New Model SWE-bench",
          },
        ],
      })
    ),
    model,
    searchResults
  );
  assert.equal(allRejected.evidence.length, 0);
  assert.deepEqual(allRejected.rejectedRows, [
    { index: 0, reasonCodes: ["model_identity_mismatch"] },
  ]);
  assert.deepEqual(allRejected.rejectionCounts, { model_identity_mismatch: 1 });
});

test("catalog backfill transaction leaves no marker when an identity insert fails", () => {
  const db = core.getDbInstance();
  db.exec(`
    CREATE TRIGGER fail_model_benchmark_enqueue
    BEFORE INSERT ON model_benchmark_search_models
    WHEN NEW.model_id = 'abort-model'
    BEGIN
      SELECT RAISE(ABORT, 'forced enqueue failure');
    END;
  `);

  assert.throws(
    () =>
      searchDb.enqueueModelsDevCatalogIdentities(
        [
          { id: "queued-before-abort", name: "Queued Before Abort" },
          { id: "abort-model", name: "Abort Model" },
        ],
        { hasRows: false, ids: new Set() }
      ),
    /forced enqueue failure/
  );
  assert.equal(searchDb.listModelBenchmarkSearchRuns().length, 0);
  assert.equal(
    db
      .prepare("SELECT 1 FROM model_benchmark_search_state WHERE state_key = ?")
      .get("models_dev_full_catalog_backfill"),
    undefined
  );
});

test("full-catalog enqueue ignores duplicate IDs within one snapshot", () => {
  const result = searchDb.enqueueModelsDevCatalogIdentities(
    [
      { id: "duplicate-model", name: "Duplicate Model" },
      { id: "duplicate-model", name: "Duplicate Model" },
    ],
    { hasRows: true, ids: new Set(["duplicate-model"]) }
  );

  assert.deepEqual(result, { fullBackfill: true, queued: 1 });
  assert.deepEqual(
    searchDb.listModelBenchmarkSearchRuns().map((run) => run.modelId),
    ["duplicate-model"]
  );
});

test("catalog sync refreshes a renamed model without resetting its queue state", () => {
  searchDb.enqueueModelBenchmarkSearches([{ id: "renamed-model", name: "Old Name" }]);
  const lastRunAt = "2026-10-25T12:00:00.000Z";
  core
    .getDbInstance()
    .prepare(
      `UPDATE model_benchmark_search_models
       SET status = 'running', normalization_status = 'in_progress', attempts = 2, last_run_at = ?
       WHERE model_id = ?`
    )
    .run(lastRunAt, "renamed-model");
  core
    .getDbInstance()
    .prepare("INSERT INTO model_benchmark_search_state (state_key, state_value) VALUES (?, ?)")
    .run("models_dev_full_catalog_backfill", "queued");

  const result = searchDb.enqueueModelsDevCatalogIdentities(
    [{ id: "renamed-model", name: "Current Name" }],
    { hasRows: true, ids: new Set(["renamed-model"]) }
  );

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.deepEqual(result, { fullBackfill: false, queued: 0 });
  assert.equal(run.modelName, "Current Name");
  assert.equal(run.status, "running");
  assert.equal(run.normalizationStatus, "in_progress");
  assert.equal(run.attempts, 2);
  assert.equal(run.lastRunAt, lastRunAt);
});

test("AA-key-blocked rows retry immediately after the key is configured", () => {
  searchDb.enqueueModelBenchmarkSearches([{ id: "aa-key-model", name: "AA Key Model" }]);
  core
    .getDbInstance()
    .prepare(
      `UPDATE model_benchmark_search_models
       SET status = 'source_error', attempts = 1, last_run_at = ?, last_error = ?
       WHERE model_id = ?`
    )
    .run(new Date().toISOString(), "AA Free API key is not configured", "aa-key-model");

  assert.equal(searchDb.hasEligibleModelBenchmarkSearch(), false);
  assert.equal(searchDb.claimModelBenchmarkSearch(), null);

  process.env.AA_API_KEY = "test-only-key";

  assert.equal(searchDb.hasEligibleModelBenchmarkSearch(), true);
  assert.equal(searchDb.claimModelBenchmarkSearch()?.modelId, "aa-key-model");
  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "running");
  assert.equal(run.attempts, 2);
});

test("AA-key recovery may retry exhausted rows without bypassing other source backoff", () => {
  searchDb.enqueueModelBenchmarkSearches([
    { id: "aa-exhausted-model", name: "AA Exhausted Model" },
    { id: "other-error-model", name: "Other Error Model" },
  ]);
  const update = core.getDbInstance().prepare(
    `UPDATE model_benchmark_search_models
     SET status = ?, attempts = ?, last_run_at = ?, last_error = ?
     WHERE model_id = ?`
  );
  const lastRunAt = new Date().toISOString();
  update.run(
    "retry_exhausted_unrated",
    5,
    lastRunAt,
    "AA Free API key is not configured",
    "aa-exhausted-model"
  );
  update.run(
    "source_error",
    1,
    lastRunAt,
    "Terminal-Bench source returned 503",
    "other-error-model"
  );
  process.env.AA_API_KEY = "test-only-key";

  assert.equal(searchDb.claimModelBenchmarkSearch()?.modelId, "aa-exhausted-model");
  const runs = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(runs.find((run) => run.modelId === "aa-exhausted-model")?.attempts, 6);
  assert.equal(runs.find((run) => run.modelId === "other-error-model")?.status, "source_error");
  assert.equal(searchDb.hasEligibleModelBenchmarkSearch(), false);
});

test("search retries stop after five attempts", () => {
  searchDb.enqueueModelBenchmarkSearches([{ id: "retry-model", name: "Retry Model" }]);
  core
    .getDbInstance()
    .prepare(
      `
      UPDATE model_benchmark_search_models
      SET status = 'pending_unrated', attempts = 5, last_run_at = ?
      WHERE model_id = ?
    `
    )
    .run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), "retry-model");

  assert.equal(searchDb.claimModelBenchmarkSearch(), null);
  assert.equal(searchDb.listModelBenchmarkSearchRuns()[0].status, "retry_exhausted_unrated");
});

test("max-attempt rows are cleaned before the queue loads sources", async () => {
  searchDb.enqueueModelBenchmarkSearches([{ id: "exhausted-model", name: "Exhausted Model" }]);
  core
    .getDbInstance()
    .prepare(
      `UPDATE model_benchmark_search_models
       SET status = 'pending_unrated', attempts = 5, last_run_at = ?, last_error = ?
       WHERE model_id = ?`
    )
    .run(new Date().toISOString(), "Search source failed", "exhausted-model");

  const originalFetch = globalThis.fetch;
  let sourceFetchCalled = false;
  globalThis.fetch = async () => {
    sourceFetchCalled = true;
    throw new Error("Exhausted rows must not load source snapshots");
  };

  try {
    await search.drainModelBenchmarkSearchQueue();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sourceFetchCalled, false);
  assert.equal(searchDb.hasEligibleModelBenchmarkSearch(), false);
  assert.equal(searchDb.listModelBenchmarkSearchRuns()[0].status, "retry_exhausted_unrated");
});

test("full-catalog drain processes a bounded batch and resumes remaining models", async () => {
  searchDb.enqueueModelBenchmarkSearches(
    Array.from({ length: 21 }, (_, index) => ({
      id: `batch-model-${index}`,
      name: `Batch Model ${index}`,
    }))
  );
  globalThis.fetch = async () => {
    throw new Error("network disabled in batch test");
  };

  await search.drainModelBenchmarkSearchQueue();
  const firstBatch = searchDb.listModelBenchmarkSearchRuns(100);
  assert.equal(firstBatch.filter((run) => run.status === "source_error").length, 20);
  assert.equal(firstBatch.filter((run) => run.status === "pending").length, 1);

  await search.drainModelBenchmarkSearchQueue();
  const resumed = searchDb.listModelBenchmarkSearchRuns(100);
  assert.equal(resumed.filter((run) => run.status === "source_error").length, 21);
  assert.equal(resumed.filter((run) => run.status === "pending").length, 0);
});

test("full-catalog batch materializes sources only for models it claims", async () => {
  process.env.AA_API_KEY = "test-only-key";
  const models = Array.from({ length: 21 }, (_, index) => ({
    id: `bounded-model-${index}`,
    name: `Bounded Model ${index}`,
  }));
  await addActiveCatalogModels(models);
  searchDb.enqueueModelBenchmarkSearches(models);
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: models.map((model, index) => ({
          slug: model.id,
          name: model.name,
          release_date: "2026-10-01",
          evaluations: {
            artificial_analysis_coding_index: index + 1,
            artificial_analysis_intelligence_index: index + 1,
          },
        })),
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    throw new Error(`Unexpected batch request: ${url}`);
  };

  await search.drainModelBenchmarkSearchQueue();

  const firstBatchEvidence = searchDb.listAllModelBenchmarkSearchEvidence();
  assert.equal(firstBatchEvidence.length, 40);
  assert.equal(new Set(firstBatchEvidence.map((row) => row.modelId)).size, 20);
  assert.equal(
    searchDb.listModelBenchmarkSearchRuns(100).filter((run) => run.status === "pending").length,
    1
  );
  assert.equal(
    searchDb.listModelBenchmarkSearchRuns(100).filter((run) => run.status === "scored").length,
    20
  );

  await search.drainModelBenchmarkSearchQueue();
  assert.equal(searchDb.listAllModelBenchmarkSearchEvidence().length, 42);
});

test("display names cannot masquerade as exact model IDs during source matching", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-test",
    apiKey: "ollama-search-test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  await addActiveCatalogModels([
    { id: "vendor/model-a", name: "Shared Model" },
    { id: "vendor/model-b", name: "Shared Model" },
  ]);
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [
          {
            slug: "vendor/model-a",
            name: "Shared Model",
            release_date: "2026-10-01",
            evaluations: {
              artificial_analysis_coding_index: 10,
              artificial_analysis_intelligence_index: 20,
            },
          },
          {
            slug: "external-model-id",
            name: "Shared Model",
            release_date: "2026-10-01",
            evaluations: {
              artificial_analysis_coding_index: 20,
              artificial_analysis_intelligence_index: 30,
            },
          },
        ],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) return jsonResponse([]);
    if (url === "https://ollama.com/api/web_search") {
      return jsonResponse({ results: [] });
    }
    throw new Error(`Unexpected ambiguity request: ${url}`);
  };
  searchDb.enqueueModelBenchmarkSearches([
    { id: "vendor/model-a", name: "Shared Model" },
    { id: "vendor/model-b", name: "Shared Model" },
    { id: "Shared Model", name: "Different Model" },
  ]);

  await search.drainModelBenchmarkSearchQueue();

  assert.equal(searchDb.listModelBenchmarkSearchEvidence("vendor/model-a").length, 2);
  assert.equal(searchDb.listModelBenchmarkSearchEvidence("vendor/model-b").length, 0);
  assert.equal(searchDb.listModelBenchmarkSearchEvidence("Shared Model").length, 0);
});

test("incomplete Hugging Face feeds preserve current evidence and native scores", async () => {
  process.env.AA_API_KEY = "test-only-key";
  const malformedCases: Array<{ hfDetail: unknown }> = [
    { hfDetail: { id: "queue-source-model", evalResults: null } },
    { hfDetail: { id: "queue-source-model" } },
    { hfDetail: { id: "queue-source-model", evalResults: "invalid" } },
    { hfDetail: { id: "queue-source-model", evalResults: [null] } },
    { hfDetail: { id: "queue-source-model", evalResults: [{}] } },
    {
      hfDetail: {
        id: "queue-source-model",
        evalResults: [{ dataset_id: "SWE-bench" }, null],
      },
    },
  ];

  for (const malformed of malformedCases) {
    resetStorage();
    await addActiveCatalogModels([{ id: "queue-source-model", name: "Queue Source Model" }]);
    searchDb.enqueueModelBenchmarkSearches([
      { id: "queue-source-model", name: "Queue Source Model" },
    ]);
    await providersDb.createProviderConnection({
      provider: "ollama-cloud",
      authType: "apikey",
      name: "ollama-search-malformed-source-test",
      apiKey: "ollama-search-malformed-source-test-key",
      isActive: true,
      testStatus: "active",
      providerSpecificData: {},
    });
    searchDb.upsertModelBenchmarkSearchIdentities([
      { id: "native-score-model", name: "Native Score Model" },
    ]);
    searchDb.replaceModelBenchmarkEvidenceSources([
      {
        modelId: "queue-source-model",
        source: "huggingface-eval-results",
        rows: [
          {
            evidenceHash: "old-hf-observation",
            modelId: "queue-source-model",
            source: "huggingface-eval-results",
            sourceVersion: "test",
            matchedModelId: "queue-source-model",
            matchedModelName: "Queue Source Model",
            benchmark: "SWE-bench",
            benchmarkVersion: "Verified",
            reasoningEffort: "high",
            reasoningConfig: { harness: "old-harness" },
            metric: "resolved",
            value: 0.5,
            sourceUrl: "https://huggingface.co/test",
            sourceDate: null,
            verificationStatus: "review_required",
            capturedAt: new Date().toISOString(),
          },
        ],
      },
      {
        modelId: "queue-source-model",
        source: "ollama-search",
        rows: [
          {
            evidenceHash: "old-ollama-observation",
            modelId: "queue-source-model",
            source: "ollama-search",
            sourceVersion: "test",
            matchedModelId: null,
            matchedModelName: null,
            benchmark: "Terminal-Bench",
            benchmarkVersion: null,
            reasoningEffort: null,
            reasoningConfig: { harness: "old-search-harness" },
            metric: null,
            value: null,
            sourceUrl: "https://example.org/old-result",
            sourceDate: null,
            verificationStatus: "candidate_review_required",
            capturedAt: new Date().toISOString(),
          },
        ],
      },
      {
        modelId: "native-score-model",
        source: "artificial-analysis-free",
        rows: [
          {
            evidenceHash: "native-coding-score",
            modelId: "native-score-model",
            source: "artificial-analysis-free",
            sourceVersion: "test",
            matchedModelId: "native-score-model",
            matchedModelName: "Native Score Model",
            benchmark: "Artificial Analysis Intelligence Index",
            benchmarkVersion: "4.1",
            reasoningEffort: null,
            reasoningConfig: null,
            metric: "artificial_analysis_coding_index",
            value: 70,
            sourceUrl: "https://artificialanalysis.ai/test",
            sourceDate: null,
            verificationStatus: "verified",
            capturedAt: new Date().toISOString(),
          },
          {
            evidenceHash: "native-intelligence-score",
            modelId: "native-score-model",
            source: "artificial-analysis-free",
            sourceVersion: "test",
            matchedModelId: "native-score-model",
            matchedModelName: "Native Score Model",
            benchmark: "Artificial Analysis Intelligence Index",
            benchmarkVersion: "4.1",
            reasoningEffort: null,
            reasoningConfig: null,
            metric: "artificial_analysis_intelligence_index",
            value: 80,
            sourceUrl: "https://artificialanalysis.ai/test",
            sourceDate: null,
            verificationStatus: "verified",
            capturedAt: new Date().toISOString(),
          },
        ],
      },
    ]);
    fitnessSync.publishModelBenchmarkFitnessSnapshot();
    const priorRows = searchDb.listAllModelBenchmarkSearchEvidence();
    const priorFitness = core
      .getDbInstance()
      .prepare(
        `SELECT model, source, category, score, confidence FROM model_intelligence
         WHERE source LIKE 'benchmark_fitness%' ORDER BY model, source, category`
      )
      .all();

    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
        return jsonResponse({
          intelligence_index_version: 4.1,
          pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
          data: [],
        });
      }
      if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
        return jsonResponse({ leaderboards: [] });
      }
      if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
        return jsonResponse({ rows: [] });
      }
      if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
      if (url.startsWith("https://huggingface.co/api/models?")) {
        const query = new URL(url).searchParams.get("search");
        return jsonResponse(query === "queue-source-model" ? [{ id: "queue-source-model" }] : []);
      }
      if (url.startsWith("https://huggingface.co/api/models/queue-source-model?")) {
        return jsonResponse(malformed.hfDetail ?? { ...malformed, id: "queue-source-model" });
      }
      if (url === "https://ollama.com/api/web_search") {
        return jsonResponse({
          provider: "ollama-search",
          usage: { search_cost_usd: 0 },
          results: [],
        });
      }
      throw new Error(`Unexpected malformed-source request: ${url}`);
    };

    await search.drainModelBenchmarkSearchQueue();

    assert.deepEqual(
      searchDb
        .listAllModelBenchmarkSearchEvidence()
        .filter(
          (row) =>
            row.source === "artificial-analysis-free" || row.source === "huggingface-eval-results"
        ),
      priorRows.filter(
        (row) =>
          row.source === "artificial-analysis-free" || row.source === "huggingface-eval-results"
      )
    );
    assert.deepEqual(
      core
        .getDbInstance()
        .prepare(
          `SELECT model, source, category, score, confidence FROM model_intelligence
           WHERE source LIKE 'benchmark_fitness%' ORDER BY model, source, category`
        )
        .all(),
      priorFitness
    );
  }
});

test("malformed Ollama response preserves current Ollama and structured evidence", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await addActiveCatalogModels([{ id: "queue-ollama-error", name: "Queue Ollama Error" }]);
  searchDb.enqueueModelBenchmarkSearches([
    { id: "queue-ollama-error", name: "Queue Ollama Error" },
  ]);
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-error-preserves-evidence-test",
    apiKey: "ollama-search-error-preserves-evidence-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  searchDb.replaceModelBenchmarkEvidenceSources([
    ...["ollama-search", "ollama-search-structured-output"].map((source) => ({
      modelId: "queue-ollama-error",
      source,
      rows: [
        {
          evidenceHash: `old-${source}`,
          modelId: "queue-ollama-error",
          source,
          sourceVersion: "test",
          matchedModelId: "queue-ollama-error",
          matchedModelName: "Queue Ollama Error",
          benchmark: "SWE-bench",
          benchmarkVersion: null,
          reasoningEffort: "high",
          reasoningConfig: { harness: "existing" },
          metric: "resolved",
          value: 0.5,
          sourceUrl: "https://example.org/existing",
          sourceDate: null,
          verificationStatus: "review_required",
          capturedAt: new Date().toISOString(),
        },
      ],
    })),
  ]);
  const priorRows = searchDb.listModelBenchmarkSearchEvidence("queue-ollama-error");

  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) return jsonResponse(null);
    if (url === "https://ollama.com/api/web_search") {
      return jsonResponse({
        provider: "ollama-search",
        usage: { search_cost_usd: 0 },
        results: null,
      });
    }
    throw new Error(`Unexpected malformed Ollama request: ${url}`);
  };

  await search.drainModelBenchmarkSearchQueue();

  assert.deepEqual(searchDb.listModelBenchmarkSearchEvidence("queue-ollama-error"), priorRows);
});

test("empty HF response preserves prior evidence and fitness", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await addActiveCatalogModels([{ id: "queue-empty-model", name: "Queue Empty Model" }]);
  searchDb.enqueueModelBenchmarkSearches([{ id: "queue-empty-model", name: "Queue Empty Model" }]);
  searchDb.upsertModelBenchmarkSearchIdentities([
    { id: "queue-empty-peer", name: "Queue Empty Peer" },
  ]);
  searchDb.replaceModelBenchmarkEvidenceSources([
    {
      modelId: "queue-empty-model",
      source: "huggingface-eval-results",
      rows: [
        {
          evidenceHash: "old-hf-empty-target",
          modelId: "queue-empty-model",
          source: "huggingface-eval-results",
          sourceVersion: "test",
          matchedModelId: "queue-empty-model",
          matchedModelName: "Queue Empty Model",
          benchmark: "SWE-bench Verified",
          benchmarkVersion: "v1",
          reasoningEffort: "high",
          reasoningConfig: null,
          metric: "resolved",
          value: 0.5,
          sourceUrl: "https://huggingface.co/test",
          sourceDate: null,
          verificationStatus: "source_verified_review_required",
          capturedAt: new Date().toISOString(),
        },
      ],
    },
    {
      modelId: "queue-empty-peer",
      source: "huggingface-eval-results",
      rows: [
        {
          evidenceHash: "old-hf-empty-peer",
          modelId: "queue-empty-peer",
          source: "huggingface-eval-results",
          sourceVersion: "test",
          matchedModelId: "queue-empty-peer",
          matchedModelName: "Queue Empty Peer",
          benchmark: "SWE-bench Verified",
          benchmarkVersion: "v1",
          reasoningEffort: "high",
          reasoningConfig: null,
          metric: "resolved",
          value: 0.8,
          sourceUrl: "https://huggingface.co/test",
          sourceDate: null,
          verificationStatus: "source_verified_review_required",
          capturedAt: new Date().toISOString(),
        },
      ],
    },
  ]);
  fitnessSync.publishModelBenchmarkFitnessSnapshot();
  const scoreRows = () =>
    core
      .getDbInstance()
      .prepare(
        `SELECT model, source, category, score FROM model_intelligence
         WHERE model IN ('queue-empty-model', 'queue-empty-peer')
           AND source LIKE 'benchmark_fitness%' ORDER BY model, source, category`
      )
      .all();
  const priorRows = searchDb.listModelBenchmarkSearchEvidence("queue-empty-model");
  const priorScores = scoreRows();
  assert.ok(scoreRows().some((row) => row.model === "queue-empty-model"));
  assert.ok(scoreRows().some((row) => row.model === "queue-empty-peer"));

  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) {
      return jsonResponse(
        new URL(url).searchParams.get("search") === "queue-empty-model"
          ? [{ id: "queue-empty-model" }]
          : []
      );
    }
    if (url.startsWith("https://huggingface.co/api/models/queue-empty-model?")) {
      return jsonResponse({ id: "queue-empty-model", evalResults: [] });
    }
    throw new Error(`Scored model must not run discovery search: ${url}`);
  };

  await search.drainModelBenchmarkSearchQueue();

  assert.deepEqual(searchDb.listModelBenchmarkSearchEvidence("queue-empty-model"), priorRows);
  assert.deepEqual(scoreRows(), priorScores);
});

test("empty HF and Ollama search results preserve their current source sets", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await addActiveCatalogModels([{ id: "queue-empty-model", name: "Queue Empty Model" }]);
  searchDb.enqueueModelBenchmarkSearches([{ id: "queue-empty-model", name: "Queue Empty Model" }]);
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-empty-source-test",
    apiKey: "ollama-search-empty-source-test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  searchDb.replaceModelBenchmarkEvidenceSources([
    {
      modelId: "queue-empty-model",
      source: "huggingface-eval-results",
      rows: [
        {
          evidenceHash: "old-hf-empty-test",
          modelId: "queue-empty-model",
          source: "huggingface-eval-results",
          sourceVersion: "test",
          matchedModelId: "queue-empty-model",
          matchedModelName: "Queue Empty Model",
          benchmark: "SWE-bench",
          benchmarkVersion: null,
          reasoningEffort: null,
          reasoningConfig: null,
          metric: "resolved",
          value: 0.5,
          sourceUrl: "https://huggingface.co/test",
          sourceDate: null,
          verificationStatus: "review_required",
          capturedAt: new Date().toISOString(),
        },
      ],
    },
    {
      modelId: "queue-empty-model",
      source: "ollama-search",
      rows: [
        {
          evidenceHash: "old-ollama-empty-test",
          modelId: "queue-empty-model",
          source: "ollama-search",
          sourceVersion: "test",
          matchedModelId: null,
          matchedModelName: null,
          benchmark: "SWE-bench",
          benchmarkVersion: null,
          reasoningEffort: null,
          reasoningConfig: null,
          metric: null,
          value: null,
          sourceUrl: "https://example.org/test",
          sourceDate: null,
          verificationStatus: "candidate_review_required",
          capturedAt: new Date().toISOString(),
        },
      ],
    },
  ]);
  const priorRows = searchDb.listModelBenchmarkSearchEvidence("queue-empty-model");
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) {
      return jsonResponse(
        new URL(url).searchParams.get("search") === "queue-empty-model"
          ? [{ id: "queue-empty-model" }]
          : []
      );
    }
    if (url.startsWith("https://huggingface.co/api/models/queue-empty-model?")) {
      return jsonResponse({ id: "queue-empty-model", evalResults: [] });
    }
    if (url === "https://ollama.com/api/web_search") {
      return jsonResponse({
        provider: "ollama-search",
        usage: { search_cost_usd: 0 },
        results: [],
      });
    }
    throw new Error(`Unexpected empty-source request: ${url}`);
  };

  await search.drainModelBenchmarkSearchQueue();

  assert.deepEqual(searchDb.listModelBenchmarkSearchEvidence("queue-empty-model"), priorRows);
});

test("direct source error reaches HF, then empty HF allows existing free search", async () => {
  process.env.AA_API_KEY = "test-only-key";
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  await settingsDb.updateSettings({ freeAccessPolicy: "strict" });
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-test",
    apiKey: "ollama-search-test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  await addActiveCatalogModels([
    { id: "NEW-MODEL", name: "Other Catalog Label" },
    { id: "new-error-model", name: "New Error Model" },
  ]);
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      assert.equal(new Headers(init?.headers).get("x-api-key"), "test-only-key");
      return jsonResponse({
        tier: "free",
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [{ slug: "other-model", name: "Other Model (high)", release_date: "2026-10-01" }],
      });
    }
    if (
      url ===
      "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json"
    ) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      const body = JSON.parse(String(init?.body));
      assert.ok(["2-0", "main"].includes(body.name));
      if (body.name === "main") return jsonResponse({ error: "temporarily unavailable" }, 503);
      return jsonResponse({ leaderboard: { name: body.name }, rows: [] });
    }
    if (url === "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json") {
      return jsonResponse({ generated_at: "2026-10-26T00:00:00Z", rows: [] });
    }
    if (url.startsWith("https://huggingface.co/api/models?")) {
      const query = new URL(url).searchParams.get("search");
      return jsonResponse(
        query === "new-model" || query === "new-error-model" ? [{ id: query }] : []
      );
    }
    if (url.startsWith("https://huggingface.co/api/models/new-error-model?")) {
      return jsonResponse({ error: "temporarily unavailable" }, 503);
    }
    if (url.startsWith("https://huggingface.co/api/models/new-model?")) {
      return jsonResponse({ id: "new-model", evalResults: [] });
    }
    if (url === "https://ollama.com/api/web_search") {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer ollama-search-test-key");
      const body = JSON.parse(String(init?.body));
      assert.match(
        body.query,
        /^"(?:new-model|new-error-model)" benchmark evaluation reasoning effort$/
      );
      assert.equal(body.max_results, 10);
      return jsonResponse({
        results: [
          {
            title: "Benchmark report",
            url: "https://example.org/eval",
            content: "Model evaluation",
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  searchDb.enqueueModelBenchmarkSearches([
    { id: "new-model", name: "New Model" },
    { id: "new-error-model", name: "New Error Model" },
  ]);
  await search.drainModelBenchmarkSearchQueue();

  const runs = searchDb.listModelBenchmarkSearchRuns();
  const run = runs.find(({ modelId }) => modelId === "new-model");
  const errorRun = runs.find(({ modelId }) => modelId === "new-error-model");
  assert.ok(run);
  assert.ok(errorRun);
  assert.equal(run.status, "review_required");
  assert.equal(run.normalizationStatus, "blocked_no_internal_api_key");
  assert.equal(run.sourceStatus.artificialAnalysis.status, "missing");
  assert.equal(run.sourceStatus.sweBench.status, "missing");
  assert.equal(run.sourceStatus.terminalBench20.status, "missing");
  assert.equal(run.sourceStatus.terminalBench21.status, "error");
  assert.equal(run.sourceStatus.deepSwe.status, "missing");
  assert.equal(run.sourceStatus.ollamaSearch.provider, "ollama-search");
  assert.equal(run.sourceStatus.ollamaSearch.searchCostUsd, 0);
  assert.equal(run.sourceStatus.normalizationProcessor.status, "blocked_no_internal_api_key");
  assert.equal(run.sourceStatus.normalizationProcessor.candidateCount, 1);
  assert.equal(run.sourceStatus.normalizationProcessor.normalizerRequestCount, 0);
  assert.equal(errorRun.sourceStatus.huggingFace.status, "error");
  assert.equal(searchDb.listModelBenchmarkSearchRuns().length, 2);
  assert.equal(urls.filter((url) => url === "https://ollama.com/api/web_search").length, 2);
  assert.ok(
    urls.findIndex((url) => url.startsWith("https://huggingface.co/api/models?")) <
      urls.findIndex((url) => url === "https://ollama.com/api/web_search")
  );
  assert.equal(
    urls.some((url) => /searchapi|perplexity|tavily|exa\.ai/i.test(url)),
    false
  );

  for (const modelId of ["new-model", "new-error-model"]) {
    const rows = searchDb.listModelBenchmarkSearchEvidence(modelId);
    const hfEvidence = rows.find((row) => row.source === "huggingface-eval-results");
    const webEvidence = rows.find((row) => row.source === "ollama-search");
    assert.equal(hfEvidence, undefined);
    assert.ok(webEvidence);
    assert.equal(webEvidence.value, null);
    assert.equal(webEvidence.matchedModelId, null);
    assert.equal(webEvidence.matchedModelName, null);
    assert.equal(webEvidence.verificationStatus, "candidate_review_required");
    assert.equal(rows.length, 1);
  }
});

test("complete direct miss stays unrated when model ID is absent from active synced catalogs", async () => {
  process.env.AA_API_KEY = "test-only-key";
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-catalog-gate-test",
    apiKey: "ollama-search-catalog-gate-test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  await addActiveCatalogModels([{ id: "provider/outside-model", name: "Unavailable Model" }]);

  let hfCalls = 0;
  let searchCalls = 0;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        tier: "free",
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) {
      hfCalls += 1;
      return jsonResponse([]);
    }
    if (url === "https://ollama.com/api/web_search") {
      searchCalls += 1;
      return jsonResponse({ results: [] });
    }
    throw new Error(`Unexpected catalog eligibility request: ${url}`);
  };

  searchDb.enqueueModelBenchmarkSearches([{ id: "outside-model", name: "Unavailable Model" }]);
  await search.drainModelBenchmarkSearchQueue();

  assert.equal(hfCalls, 0);
  assert.equal(searchCalls, 0);
  assert.equal(
    urls.some((url) => url.includes("openrouter.ai/api/v1/chat/completions")),
    false
  );
  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "unrated_no_evidence");
  assert.equal(run.normalizationStatus, "not_started");
  assert.deepEqual(run.sourceStatus.catalogEligibility, {
    status: "unavailable",
    reason: "model_not_in_active_synced_catalog",
  });
});

test("operator reprocess covers every canonical catalog ID without queue or search work", async () => {
  process.env.AA_API_KEY = "test-only-key";
  const providerPrefixedIds = [
    "nvidia/deepseek-ai/deepseek-v4.1-flash",
    "nvidia/google/diffusiongemma-26b-a4b-it",
    "nvidia/meta/llama-3.2-11b-vision-instruct",
    "nvidia/meta/llama-3.2-90b-vision-instruct",
    "nvidia/meta/muse-glimmer-30b",
    "nvidia/minimaxai/minimax-m3.1-flash",
    "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b",
    "nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b",
    "nvidia/poolside/laguna-xs-2.1",
    "nvidia/stepfun-ai/step-5-preview",
    "nvidia/z-ai/glm-5.3",
    "nvidia/z-ai/glm-5.3-flash",
    "openrouter/recursive/flint-v1.0:free",
    "openrouter/xingchen-agi/xing4.0-29b-a4b:free",
    "openrouter/nvidia/nemotron-3.5-super-vl:free",
    "openrouter/dots-studio/dots-3-note-preview:free",
    "openrouter/nvidia/nemotron-3.5-lightning:free",
    "openrouter/thinkingmachines/inkling-small:free",
    "openrouter/poolside/laguna-s-2.1:free",
    "openrouter/thinkingmachines/inkling:free",
    "openrouter/poolside/laguna-xs-2.1:free",
    "openrouter/cohere/north-mini-code:free",
    "openrouter/nvidia/nemotron-3.5-content-safety:free",
    "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
    "openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "openrouter/google/gemma-4-26b-a4b-it:free",
    "openrouter/google/gemma-4-31b-it:free",
    "openrouter/google/lyria-3-pro-preview",
    "openrouter/google/lyria-3-clip-preview",
    "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    "groq/allam-2-7b",
  ];
  const models = [
    ...Array.from({ length: 109 }, (_, index) => ({
      id: index === 0 ? "Catalog-000" : `catalog-${String(index).padStart(3, "0")}`,
      name:
        index === 4 || index === 5
          ? "Ambiguous Catalog Name"
          : `Catalog Model ${String(index).padStart(3, "0")}`,
    })),
    ...providerPrefixedIds.map((id) => ({ id, name: id })),
  ];
  searchDb.upsertModelBenchmarkSearchIdentities(models);
  core
    .getDbInstance()
    .prepare(`UPDATE model_benchmark_search_models SET status = 'scored' WHERE model_id = ?`)
    .run(models[3].id);
  const beforeIdentityCount = core
    .getDbInstance()
    .prepare("SELECT COUNT(*) AS count FROM model_benchmark_search_models")
    .get().count;
  core.getDbInstance().exec(`
    CREATE TABLE profile_publication_audit (count INTEGER NOT NULL);
    INSERT INTO profile_publication_audit VALUES (0);
    CREATE TRIGGER count_profile_publications
    AFTER INSERT ON model_intelligence
    WHEN NEW.source LIKE 'benchmark_fitness:%'
    BEGIN
      UPDATE profile_publication_audit SET count = count + 1;
    END;
  `);
  const retainedAaRow = {
    slug: models[3].id,
    name: `${models[3].name} (high)`,
    release_date: "2026-10-01",
    evaluations: {
      artificial_analysis_coding_index: 12,
      artificial_analysis_intelligence_index: 24,
    },
  };
  insertLegacyAaCodingEvidence(models[3].id, retainedAaRow, 12);

  const urls: string[] = [];
  let newIdentitiesStartedUnrated = false;
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url === "https://models.dev/api.json") {
      return jsonResponse({
        fixture: {
          models: Object.fromEntries(models.map(({ id, name }) => [id, { id, name }])),
        },
      });
    }
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      newIdentitiesStartedUnrated =
        core
          .getDbInstance()
          .prepare(
            `SELECT COUNT(*) AS count FROM model_benchmark_search_models
             WHERE status != 'unrated_no_evidence' AND model_id != ?`
          )
          .get(models[3].id).count === 0;
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [
          {
            slug: models[0].id,
            name: `${models[0].name} (high)`,
            evaluations: {
              artificial_analysis_coding_index: 20,
              artificial_analysis_intelligence_index: 30,
            },
          },
          {
            slug: models[1].id,
            name: `${models[1].name} (high)`,
            evaluations: {
              artificial_analysis_coding_index: 10,
              artificial_analysis_intelligence_index: 15,
            },
          },
          {
            name: "Ambiguous Catalog Name",
            evaluations: {
              artificial_analysis_coding_index: 8,
              artificial_analysis_intelligence_index: 12,
            },
          },
          {
            slug: providerPrefixedIds[0],
            name: `${providerPrefixedIds[0]} (high)`,
            evaluations: {
              artificial_analysis_coding_index: 20,
              artificial_analysis_intelligence_index: 30,
            },
          },
        ],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({
        leaderboards: [
          { name: "Verified", results: [{ model_display: models[2].name, resolved: 5 }] },
        ],
      });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      const requestBody = JSON.parse(String(init?.body ?? "{}"));
      if (requestBody.name === "main") {
        return jsonResponse({ rows: [{ metadata: { model_id: "unlisted/model" }, metrics: {} }] });
      }
      return jsonResponse({ rows: [{ metadata: { model_id: "unlisted/model" }, metrics: {} }] });
    }
    if (url.includes("deepswe.datacurve.ai")) {
      return jsonResponse({ rows: [{ model: "unlisted/model", pass_rate: 0.2 }] });
    }
    throw new Error(`Unexpected operator reprocess request: ${url}`);
  };

  const result = await search.reprocessModelBenchmarkSearchEvidence();
  assert.ok(result.fitness);
  const receiptById = new Map(result.receipts.map((receipt) => [receipt.modelId, receipt]));
  assert.equal(result.receipts.length, 140);
  assert.equal(receiptById.get(models[0].id)?.identityStatus, "matched");
  assert.equal(receiptById.get(models[0].id)?.evidenceStatus, "matched");
  assert.equal(receiptById.get(models[0].id)?.sources.artificialAnalysis.records, 2);
  assert.equal(receiptById.get(models[2].id)?.sources.sweBench.records, 1);
  assert.equal(receiptById.get(models[3].id)?.sources.artificialAnalysis.records, 0);
  assert.equal(
    receiptById.get(models[4].id)?.sources.artificialAnalysis.identityMatch,
    "ambiguous"
  );
  assert.equal(receiptById.get(models[4].id)?.sources.artificialAnalysis.records, 0);
  assert.equal(receiptById.get(providerPrefixedIds[0])?.evidenceStatus, "matched");
  assert.equal(receiptById.get(providerPrefixedIds[0])?.sources.artificialAnalysis.records, 2);
  assert.deepEqual(
    result.receipts.map((receipt) => receipt.modelId).sort(),
    models.map((model) => model.id).sort()
  );
  assert.equal(newIdentitiesStartedUnrated, true);
  assert.equal(result.evidenceWrites, 7);
  assert.ok(result.fitness.observationCount >= 7);
  assert.ok(result.fitness.profilePublishedCount > 0);
  assert.ok(result.fitness.publishedCount >= result.fitness.profilePublishedCount);
  assert.equal(
    core.getDbInstance().prepare("SELECT count FROM profile_publication_audit").get().count,
    result.fitness.profilePublishedCount
  );
  assert.equal(urls.filter((url) => url !== "https://models.dev/api.json").length, 5);
  assert.equal(urls.filter((url) => url === "https://models.dev/api.json").length, 1);
  assert.equal(
    urls.some((url) => url.includes("huggingface.co")),
    false
  );
  assert.equal(
    urls.some((url) => url.includes("ollama.com/api/web_search")),
    false
  );
  assert.equal(
    urls.some((url) => url.includes("openrouter.ai/api/v1/chat/completions")),
    false
  );

  const identityRows = core
    .getDbInstance()
    .prepare(
      `SELECT model_id, status, attempts, last_run_at FROM model_benchmark_search_models
       ORDER BY model_id`
    )
    .all();
  assert.equal(identityRows.length, 140);
  assert.equal(
    identityRows.find((row) => row.model_id === models[3].id).status,
    "unrated_no_evidence"
  );
  assert.equal(identityRows.find((row) => row.model_id === models[0].id).status, "scored");
  assert.equal(
    identityRows.find((row) => row.model_id === providerPrefixedIds[0]).status,
    "scored"
  );
  assert.ok(
    identityRows.every((row) =>
      ["scored", "review_required", "unrated_no_evidence"].includes(row.status)
    )
  );
  assert.ok(
    providerPrefixedIds
      .slice(1)
      .every((id) => receiptById.get(id)?.processingStatus === "unrated_no_evidence")
  );
  assert.equal(receiptById.get(providerPrefixedIds[0])?.processingStatus, "scored");
  assert.ok(identityRows.every((row) => row.attempts === 0 && row.last_run_at === null));
  assert.equal(searchDb.hasEligibleModelBenchmarkSearch(), false);
  assert.equal(searchDb.claimModelBenchmarkSearch(), null);
  const runtimeEvidence = searchDb.listModelBenchmarkSearchEvidence(providerPrefixedIds[0]);
  assert.equal(runtimeEvidence.length, 2);
  assert.ok(runtimeEvidence.every((row) => row.modelId === providerPrefixedIds[0]));
  assert.equal(
    searchDb.listModelBenchmarkSearchEvidence("deepseek-ai/deepseek-v4.1-flash").length,
    0
  );
  assert.equal(
    core
      .getDbInstance()
      .prepare("SELECT COUNT(*) AS count FROM model_benchmark_search_models")
      .get().count - beforeIdentityCount,
    0
  );
  assert.ok(
    core
      .getDbInstance()
      .prepare(
        `SELECT COUNT(*) AS count FROM model_intelligence
                WHERE source IN ('benchmark_fitness:low', 'benchmark_fitness:medium', 'benchmark_fitness:high')`
      )
      .get().count > 0
  );
});

test("incomplete direct feeds reach HF and usable HF evidence suppresses web search", async () => {
  process.env.AA_API_KEY = "test-only-key";
  let hfCalls = 0;
  let searchCalls = 0;
  let terminal21Calls = 0;
  let aaCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      aaCalls += 1;
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { has_more: true },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      const body = JSON.parse(String(init?.body));
      if (body.name === "main") {
        terminal21Calls += 1;
        return jsonResponse({ error: "temporarily unavailable" }, 503);
      }
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) {
      hfCalls += 1;
      return new URL(url).searchParams.get("search") === "incomplete-model"
        ? jsonResponse([{ id: "incomplete-model" }])
        : jsonResponse([]);
    }
    if (url.startsWith("https://huggingface.co/api/models/incomplete-model?")) {
      hfCalls += 1;
      return jsonResponse({
        id: "incomplete-model",
        evalResults: [{ dataset_id: "SWE-bench Verified", value: 0.72, verified: true }],
      });
    }
    if (url === "https://ollama.com/api/web_search") {
      searchCalls += 1;
      return jsonResponse({ results: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  await addActiveCatalogModels([{ id: "incomplete-model", name: "Incomplete Model" }]);
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-hf-short-circuit-test",
    apiKey: "ollama-search-hf-short-circuit-test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  searchDb.enqueueModelBenchmarkSearches([{ id: "incomplete-model", name: "Incomplete Model" }]);
  insertLegacyAaCodingEvidence(
    "incomplete-model",
    { slug: "incomplete-model", name: "Incomplete Model" },
    34
  );
  await search.drainModelBenchmarkSearchQueue();

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "review_required");
  assert.equal(run.sourceStatus.artificialAnalysis.status, "incomplete");
  assert.equal(run.sourceStatus.terminalBench21.status, "error");
  assert.equal(run.sourceStatus.huggingFace.status, "found");
  assert.equal(aaCalls, 5);
  assert.equal(terminal21Calls, 2);
  assert.equal(hfCalls, 3);
  assert.equal(searchCalls, 0);
  const rows = searchDb.listModelBenchmarkSearchEvidence("incomplete-model");
  assert.equal(rows.find((row) => row.source === "artificial-analysis-free")?.value, 34);
  assert.ok(rows.some((row) => row.source === "huggingface-eval-results" && row.value === 0.72));
});

test("incomplete feeds preserve prior AA rows without reparsing retained payloads", async () => {
  process.env.AA_API_KEY = "test-only-key";
  const aaRow = {
    slug: "incomplete-repair-model",
    name: "Incomplete Repair Model (high)",
    evaluations: {},
  };
  searchDb.enqueueModelBenchmarkSearches([
    { id: "incomplete-repair-model", name: "Incomplete Repair Model" },
  ]);
  insertLegacyAaCodingEvidence("incomplete-repair-model", aaRow, null);
  let hfCalls = 0;
  let searchCalls = 0;
  let normalizationCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.name === "main") return jsonResponse({ error: "temporarily unavailable" }, 503);
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) {
      hfCalls += 1;
      return jsonResponse([]);
    }
    if (url === "https://ollama.com/api/web_search") {
      searchCalls += 1;
      return jsonResponse({ results: [] });
    }
    if (url.includes("openrouter.ai/api/v1/chat/completions")) normalizationCalls += 1;
    throw new Error(`Unexpected request while repairing retained AA evidence: ${url}`);
  };

  await search.drainModelBenchmarkSearchQueue();

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  const repairedRows = searchDb
    .listModelBenchmarkSearchEvidence("incomplete-repair-model")
    .filter((row) => row.source === "artificial-analysis-free");
  assert.equal(run.status, "source_error");
  assert.equal(run.sourceStatus.terminalBench21.status, "error");
  assert.equal(repairedRows.length, 1);
  assert.equal(repairedRows[0].metric, "artificial_analysis_coding_index");
  assert.equal(repairedRows[0].value, null);
  assert.equal(hfCalls, 0);
  assert.equal(searchCalls, 0);
  assert.equal(normalizationCalls, 0);
});

test("complete AA refresh replaces legacy rows with current observations", async () => {
  process.env.AA_API_KEY = "test-only-key";
  const urls: string[] = [];
  const aaRow = {
    slug: "new-model",
    name: "New Model (high)",
    release_date: "2026-10-01",
    evaluations: {
      artificial_analysis_coding_index: 20,
      artificial_analysis_intelligence_index: 30,
    },
  };
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [
          {
            slug: "peer-model",
            name: "Peer Model (high)",
            release_date: "2026-10-01",
            evaluations: {
              artificial_analysis_coding_index: 10,
              artificial_analysis_intelligence_index: 15,
            },
          },
          {
            slug: "new-model",
            name: "New Model (high)",
            release_date: "2026-10-02",
            evaluations: {
              artificial_analysis_coding_index: 21,
              artificial_analysis_intelligence_index: 31,
            },
          },
        ],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({
        leaderboards: [
          { name: "Verified", results: [{ model_display: "New Model", resolved: 0 }] },
        ],
      });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    throw new Error(`Discovery search must not run: ${url}`);
  };

  searchDb.enqueueModelBenchmarkSearches([
    { id: "new-model", name: "New Model" },
    { id: "peer-model", name: "Peer Model" },
  ]);
  insertLegacyAaCodingEvidence("new-model", aaRow, 20);
  searchDb.saveModelBenchmarkSearchEvidence(
    Array.from({ length: 100 }, (_, index) => ({
      evidenceHash: `retained-aa-test-noise-${index}`,
      modelId: "new-model",
      source: "unrelated-test-fixture",
      sourceVersion: null,
      matchedModelId: null,
      matchedModelName: null,
      benchmark: null,
      benchmarkVersion: null,
      reasoningEffort: null,
      reasoningConfig: null,
      metric: null,
      value: null,
      sourceUrl: "https://example.test/evidence",
      sourceDate: null,
      verificationStatus: "source_record_unreviewed",
      capturedAt: new Date(Date.UTC(2100, 0, 1, 0, 0, index)).toISOString(),
    }))
  );
  const recentEvidence = searchDb.listModelBenchmarkSearchEvidence("new-model");
  assert.equal(recentEvidence.length, 100);
  assert.equal(
    recentEvidence.some((item) => item.source === "artificial-analysis-free"),
    false
  );
  await search.drainModelBenchmarkSearchQueue();

  const aaEvidence = searchDb
    .listAllModelBenchmarkSearchEvidence()
    .filter((item) => item.modelId === "new-model")
    .filter((item) => item.source === "artificial-analysis-free");
  assert.equal(aaEvidence.length, 2);
  assert.deepEqual(aaEvidence.map((item) => [item.metric, item.value]).sort(), [
    ["artificial_analysis_coding_index", 21],
    ["artificial_analysis_intelligence_index", 31],
  ]);

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "scored");
  assert.equal(run.sourceStatus.artificialAnalysis.status, "found");
  assert.equal(run.sourceStatus.sweBench.status, "found");
  assert.equal(typeof run.sourceStatus.fitness.codingFitness, "number");
  assert.equal(typeof run.sourceStatus.fitness.generalFitness, "number");
  assert.equal(run.sourceStatus.fitness.generalFallback, false);
  assert.equal(typeof run.sourceStatus.fitness.generalFamilyVotes["aa-intelligence"], "number");
  const persistedProfileFitness = core
    .getDbInstance()
    .prepare(
      `SELECT score, confidence FROM model_intelligence
       WHERE model = ? AND source = 'benchmark_fitness:high' AND category = 'default'`
    )
    .get("new-model");
  assert.ok(persistedProfileFitness);
  assert.equal(typeof persistedProfileFitness.score, "number");
  assert.equal(persistedProfileFitness.confidence.includes("reciprocal_task_fallback"), false);
  const firstFitness = await fitnessSync.recomputeModelBenchmarkFitness();
  const firstModelFitness = firstFitness.scores.find((item) => item.modelId === "new-model");
  assert.ok(firstModelFitness);
  assert.equal(firstModelFitness.generalFallback, false);
  assert.equal(typeof firstModelFitness.generalFamilyVotes["aa-intelligence"], "number");
  assert.ok(aaEvidence.every((item) => !("raw" in item)));
  assert.notEqual(aaEvidence[0].evidenceHash, aaEvidence[1].evidenceHash);
  assert.equal(aaEvidence.length, 2);
  assert.equal(
    searchDb
      .listAllModelBenchmarkSearchEvidence()
      .filter((item) => item.modelId === "new-model")
      .filter((item) => item.source === "artificial-analysis-free").length,
    2
  );

  core
    .getDbInstance()
    .prepare(
      `UPDATE model_benchmark_search_models
       SET status = 'pending', last_run_at = NULL, retry_after_at = NULL
       WHERE model_id = ?`
    )
    .run("new-model");
  await search.drainModelBenchmarkSearchQueue();

  const rerunAaEvidence = searchDb
    .listAllModelBenchmarkSearchEvidence()
    .filter((item) => item.modelId === "new-model")
    .filter((item) => item.source === "artificial-analysis-free");
  assert.equal(rerunAaEvidence.length, 2);
  assert.deepEqual(rerunAaEvidence.map((item) => [item.metric, item.value]).sort(), [
    ["artificial_analysis_coding_index", 21],
    ["artificial_analysis_intelligence_index", 31],
  ]);
  const secondFitness = await fitnessSync.recomputeModelBenchmarkFitness();
  const secondModelFitness = secondFitness.scores.find((item) => item.modelId === "new-model");
  assert.ok(secondModelFitness);
  assert.deepEqual(secondModelFitness, firstModelFitness);
  const row = searchDb
    .listAllModelBenchmarkSearchEvidence()
    .filter((item) => item.modelId === "new-model")
    .find((item) => item.source === "swe-bench");
  assert.ok(row);
  assert.equal(row.source, "swe-bench");
  assert.equal(row.benchmarkVersion, "Verified");
  assert.equal(row.value, 0);
  assert.equal(row.reasoningEffort, null);
  assert.equal(
    urls.some((url) => url.includes("huggingface.co")),
    false
  );
  assert.equal(
    urls.some((url) => url === "https://ollama.com/api/web_search"),
    false
  );
});

test("an exact AA model without a usable score is reviewed without web search", async () => {
  process.env.AA_API_KEY = "test-only-key";
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [
          { slug: "metadata-only-model", name: "Metadata Only Model" },
          {
            slug: "peer-model",
            name: "Peer Model",
            evaluations: {
              artificial_analysis_coding_index: 10,
              artificial_analysis_intelligence_index: 15,
            },
          },
        ],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url === "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json") {
      return jsonResponse({ rows: [] });
    }
    throw new Error(`Discovery search must not run: ${url}`);
  };

  searchDb.enqueueModelBenchmarkSearches([
    { id: "metadata-only-model", name: "Metadata Only Model" },
    { id: "peer-model", name: "Peer Model" },
  ]);
  await search.drainModelBenchmarkSearchQueue();

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "review_required");
  assert.equal(run.sourceStatus.artificialAnalysis.status, "found");
  assert.equal(run.normalizationStatus, "not_needed");
  assert.equal(run.sourceStatus.fitness.codingFitness, null);
  assert.equal(run.sourceStatus.fitness.generalFitness, null);
  assert.equal(
    urls.some((url) => url.includes("huggingface.co")),
    false
  );
  assert.equal(
    urls.some((url) => url === "https://ollama.com/api/web_search"),
    false
  );
});

test("AA exact slug matches when display name includes a reasoning effort", async () => {
  process.env.AA_API_KEY = "test-only-key";
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [
          {
            slug: "new-model",
            name: "New Model (high)",
            release_date: "2026-10-01",
            evaluations: {
              artificial_analysis_coding_index: 20,
              artificial_analysis_intelligence_index: 30,
            },
          },
          {
            slug: "peer-model",
            name: "Peer Model (high)",
            release_date: "2026-10-01",
            evaluations: {
              artificial_analysis_coding_index: 10,
              artificial_analysis_intelligence_index: 15,
            },
          },
        ],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url === "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json") {
      return jsonResponse({ rows: [] });
    }
    throw new Error(`Discovery search must not run: ${url}`);
  };

  searchDb.enqueueModelBenchmarkSearches([
    { id: "new-model", name: "New Model" },
    { id: "peer-model", name: "Peer Model" },
  ]);
  await search.drainModelBenchmarkSearchQueue();

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "scored");
  assert.equal(run.sourceStatus.artificialAnalysis.status, "found");
  const [row] = searchDb.listModelBenchmarkSearchEvidence("new-model");
  assert.equal(row.matchedModelId, "new-model");
  assert.equal(row.reasoningEffort, "high");
});

test("a strict-SO Auto 504 defers the queue before another model is claimed", async () => {
  process.env.AA_API_KEY = "test-only-key";
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  await settingsDb.updateSettings({ freeAccessPolicy: "strict", modelsDevSyncEnabled: true });
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-timeout-test",
    apiKey: "ollama-search-timeout-test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  const normalizationConnection = (await providersDb.createProviderConnection({
    provider: "openrouter",
    authType: "apikey",
    name: "openrouter-normalization-timeout-test",
    apiKey: "openrouter-normalization-timeout-test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  })) as { id: string };
  const db = core.getDbInstance();
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    "syncedAvailableModels",
    `openrouter:${normalizationConnection.id}`,
    JSON.stringify([{ id: "normalizer-timeout-model:free", isFree: true }])
  );
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    "models_dev_zero_price",
    "snapshot",
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      modelsByProvider: { openrouter: ["normalizer-timeout-model:free"] },
    })
  );
  modelsDevSync.upsertSyncedCapabilities("openrouter", {
    "normalizer-timeout-model:free": {
      tool_call: true,
      reasoning: true,
      attachment: null,
      structured_output: true,
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
    },
  });
  modelIntelligenceDb.upsertModelIntelligence({
    model: "normalizer-timeout-model:free",
    source: "models_dev_tier",
    category: "default",
    score: 0.95,
    eloRaw: null,
    confidence: "high",
    expiresAt: null,
  });
  taskFitness.invalidateFitnessCache();
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities({
      provider: "openrouter",
      model: "normalizer-timeout-model:free",
    }).structuredOutput,
    true
  );
  assert.equal(
    tierResolver.classifyTier("openrouter", "normalizer-timeout-model:free").tier,
    "free"
  );
  assert.deepEqual(
    taskFitness.getTaskFitnessWithSource("normalizer-timeout-model:free", "default", "high"),
    {
      score: 0.95,
      source: "models_dev_tier",
    }
  );
  const strictFreeBandCheck = buildAutoCandidateFilter("general_high_so", "free");
  assert.equal(
    strictFreeBandCheck?.({
      provider: "openrouter",
      model: "normalizer-timeout-model:free",
      modelStr: "openrouter/normalizer-timeout-model:free",
      costPer1MTokens: 0,
    }),
    true
  );
  process.env.API_KEY_SECRET = "test-only-api-key-secret";
  await apiKeysDb.createApiKey("benchmark-timeout-test", "test-machine", ["manage"], {
    allowedConnections: [normalizationConnection.id],
  });
  await addActiveCatalogModels([
    { id: "a-slow-model", name: "Slow Model" },
    { id: "z-next-model", name: "Next Model" },
  ]);

  let chatRequestStarted = false;
  let chatRequests = 0;
  const urls: string[] = [];
  const unexpectedUrls: string[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    let scaledDelay = delay;
    if (delay === processor.NORMALIZATION_TIMEOUT_MS) scaledDelay = 20_000;
    else if (delay === 10 * 60 * 1000) scaledDelay = 8_000;
    return originalSetTimeout(callback, scaledDelay, ...args);
  }) as typeof globalThis.setTimeout;

  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        tier: "free",
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) return jsonResponse([]);
    if (url === "https://ollama.com/api/web_search") {
      const query = JSON.parse(String(init?.body)).query as string;
      return jsonResponse(
        query.includes("slow-model")
          ? { results: [{ title: "Benchmark report", url: "https://example.org/slow-eval" }] }
          : { results: [] }
      );
    }
    if (url === "https://openrouter.ai/api/v1/key") {
      return jsonResponse({ data: { label: "test account" } });
    }
    if (url === "https://openrouter.ai/api/v1/credits") {
      return jsonResponse({ data: { total_credits: 1, total_usage: 0 } });
    }
    if (url.includes("openrouter.ai/api/v1/chat/completions")) {
      chatRequestStarted = true;
      chatRequests += 1;
      const request = input instanceof Request ? input : null;
      assert.equal(
        new Headers(request?.headers ?? init?.headers).has("x-omniroute-connection"),
        false
      );
      const signal = request?.signal ?? init?.signal;
      assert.ok(signal, "Expected normalization timeout to abort upstream request");
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        if (signal.aborted) reject(signal.reason);
      });
    }
    unexpectedUrls.push(url);
    throw new Error(`Unexpected request: ${url}`);
  };

  searchDb.enqueueModelBenchmarkSearches([
    { id: "a-slow-model", name: "Slow Model" },
    { id: "z-next-model", name: "Next Model" },
  ]);
  let drain: Promise<void> | null = null;
  try {
    drain = search.drainModelBenchmarkSearchQueue();
    assert.ok(
      await waitFor(() => chatRequestStarted, 30_000),
      `No normalization dispatch; URLs: ${urls.join(", ")}`
    );
    const activeRuns = searchDb.listModelBenchmarkSearchRuns();
    const slow = activeRuns.find((run) => run.modelId === "a-slow-model");
    const next = activeRuns.find((run) => run.modelId === "z-next-model");
    assert.ok(slow);
    assert.ok(next);
    assert.equal(slow.status, "running");
    assert.equal(next.status, "pending");

    await drain;

    const runs = searchDb.listModelBenchmarkSearchRuns();
    assert.deepEqual(
      runs
        .map((run) => [run.modelId, run.status])
        .sort(([left], [right]) => left.localeCompare(right)),
      [
        ["a-slow-model", "review_required"],
        ["z-next-model", "pending"],
      ]
    );
    const completedSlow = runs.find((run) => run.modelId === "a-slow-model");
    assert.ok(completedSlow);
    assert.equal(completedSlow.normalizationStatus, "normalization_request_failed_unrated");
    assert.equal(completedSlow.sourceStatus.normalizationProcessor.error, "HTTP 504");
    assert.ok(completedSlow.retryAfterAt && Date.parse(completedSlow.retryAfterAt) > Date.now());
    assert.equal(completedSlow.sourceStatus.normalizationProcessor.normalizerRequestCount, 1);
    assert.equal(completedSlow.sourceStatus.ollamaSearch.provider, "ollama-search");
    assert.equal(completedSlow.sourceStatus.ollamaSearch.searchCostUsd, 0);
    assert.ok(
      searchDb
        .listModelBenchmarkSearchEvidence("a-slow-model")
        .some((row) => row.source === "ollama-search")
    );
    assert.equal(chatRequests, 1);
    assert.deepEqual(unexpectedUrls, []);
    assert.equal(urls.filter((url) => url === "https://ollama.com/api/web_search").length, 1);
    core
      .getDbInstance()
      .prepare("UPDATE model_benchmark_search_models SET retry_after_at = ? WHERE model_id = ?")
      .run(new Date(Date.now() - 1_000).toISOString(), "a-slow-model");
    assert.equal(searchDb.claimModelBenchmarkSearch()?.modelId, "a-slow-model");
  } finally {
    await drain?.catch(() => undefined);
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("normalized rows replace matching observations and preserve unmatched rows on failures", async () => {
  process.env.AA_API_KEY = "test-only-key";
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  process.env.API_KEY_SECRET = "test-only-api-key-secret";
  await settingsDb.updateSettings({ freeAccessPolicy: "strict", modelsDevSyncEnabled: true });
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "ollama-search-normalized-isolation-test",
    apiKey: "ollama-search-normalized-isolation-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  const normalizationConnection = (await providersDb.createProviderConnection({
    provider: "openrouter",
    authType: "apikey",
    name: "openrouter-normalized-isolation-test",
    apiKey: "openrouter-normalized-isolation-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  })) as { id: string };
  const db = core.getDbInstance();
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    "syncedAvailableModels",
    `openrouter:${normalizationConnection.id}`,
    JSON.stringify([{ id: "normalizer-current:free", isFree: true }])
  );
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    "models_dev_zero_price",
    "snapshot",
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      modelsByProvider: { openrouter: ["normalizer-current:free"] },
    })
  );
  modelsDevSync.upsertSyncedCapabilities("openrouter", {
    "normalizer-current:free": {
      tool_call: true,
      reasoning: true,
      attachment: null,
      structured_output: true,
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
    },
  });
  modelIntelligenceDb.upsertModelIntelligence({
    model: "normalizer-current:free",
    source: "models_dev_tier",
    category: "default",
    score: 0.95,
    eloRaw: null,
    confidence: "high",
    expiresAt: null,
  });
  taskFitness.invalidateFitnessCache();
  await apiKeysDb.createApiKey("benchmark-isolation-test", "test-machine", ["manage"], {
    allowedConnections: [normalizationConnection.id],
  });
  await addActiveCatalogModels([
    { id: "normalized-target", name: "Normalized Target" },
    { id: "normalized-peer", name: "Normalized Peer" },
  ]);
  searchDb.enqueueModelBenchmarkSearches([{ id: "normalized-target", name: "Normalized Target" }]);
  searchDb.upsertModelBenchmarkSearchIdentities([
    { id: "normalized-peer", name: "Normalized Peer" },
  ]);

  const oldObservation = (modelId: string, benchmarkVersion: string, value: number) => ({
    evidenceHash: `prior:${modelId}:${benchmarkVersion}`,
    modelId,
    source: "ollama-search-structured-output",
    sourceVersion: "prior-normalizer",
    matchedModelId: modelId,
    matchedModelName: modelId === "normalized-target" ? "Normalized Target" : "Normalized Peer",
    benchmark: "SWE-bench Verified",
    benchmarkVersion,
    reasoningEffort: "high",
    reasoningConfig: "agent-a",
    metric: "resolved",
    value,
    sourceUrl: "https://example.org/prior",
    sourceDate: "2026-10-01",
    verificationStatus:
      modelId === "normalized-target" ? "review_required" : "source_verified_review_required",
    capturedAt: "2026-10-01T00:00:00.000Z",
  });
  searchDb.replaceModelBenchmarkEvidenceSources([
    {
      modelId: "normalized-target",
      source: "ollama-search-structured-output",
      rows: [
        oldObservation("normalized-target", "v1", 0.2),
        oldObservation("normalized-target", "v2", 0.6),
      ],
    },
    {
      modelId: "normalized-peer",
      source: "ollama-search-structured-output",
      rows: [oldObservation("normalized-peer", "v1", 0.9)],
    },
  ]);

  const quote =
    "Normalized Target reported 0.45 resolved on SWE-bench Verified v1 with effort high config agent-a on 2026-10-27.";
  const validRow = {
    model_id: "normalized-target",
    model_name: "Normalized Target",
    reasoning_effort: "high",
    reasoning_config: "agent-a",
    benchmark: "SWE-bench Verified",
    benchmark_version: "v1",
    metric: "resolved",
    value: 0.45,
    source_url: "https://example.org/eval",
    source_date: "2026-10-27",
    evidence_quote: quote,
  };
  let normalizationResponse: unknown = {
    id: "normalized-response",
    model: "normalizer-current:free",
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            results: [validRow, { ...validRow, source_url: "https://example.org/other" }],
          }),
        },
      },
    ],
  };
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) =>
    originalSetTimeout(
      callback,
      delay === 5_000 ? 0 : delay,
      ...args
    )) as typeof globalThis.setTimeout;
  globalThis.fetch = async (input, _init) => {
    const url = requestUrl(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return jsonResponse({
        tier: "free",
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    if (url.startsWith("https://huggingface.co/api/models?")) return jsonResponse([]);
    if (url === "https://ollama.com/api/web_search") {
      return jsonResponse({
        provider: "ollama-search",
        usage: { search_cost_usd: 0 },
        results: [{ title: "SWE-bench report", url: "https://example.org/eval", content: quote }],
      });
    }
    if (url === "https://openrouter.ai/api/v1/key")
      return jsonResponse({ data: { label: "test" } });
    if (url === "https://openrouter.ai/api/v1/credits")
      return jsonResponse({ data: { total_credits: 1, total_usage: 0 } });
    if (url.includes("openrouter.ai/api/v1/chat/completions"))
      return jsonResponse(normalizationResponse);
    throw new Error(`Unexpected normalized evidence request: ${url}`);
  };

  try {
    await search.drainModelBenchmarkSearchQueue();

    const run = searchDb
      .listModelBenchmarkSearchRuns()
      .find((item) => item.modelId === "normalized-target");
    assert.ok(run);
    assert.ok(run.sourceStatus.normalizationProcessor, JSON.stringify(run));
    assert.deepEqual(run.sourceStatus.normalizationProcessor.rejectedRows, [
      { index: 1, reasonCodes: ["source_url_not_found"] },
    ]);
    assert.deepEqual(run.sourceStatus.normalizationProcessor.rejectionCounts, {
      source_url_not_found: 1,
    });
    assert.equal(
      JSON.stringify(run.sourceStatus.normalizationProcessor).includes(
        "Normalized Target reported"
      ),
      false
    );

    const normalizedRows = () =>
      searchDb
        .listModelBenchmarkSearchEvidence("normalized-target")
        .filter((row) => row.source === "ollama-search-structured-output");
    const acceptedRows = normalizedRows();
    assert.equal(acceptedRows.length, 2);
    assert.deepEqual(
      acceptedRows.map(({ benchmarkVersion, value }) => [benchmarkVersion, value]).sort(),
      [
        ["v1", 0.45],
        ["v2", 0.6],
      ]
    );
    assert.equal(
      fitnessSync.getEligibleModelBenchmarkFitnessObservations(
        searchDb.listAllModelBenchmarkSearchEvidence()
      ).length,
      3
    );
    assert.equal(
      typeof fitnessSync
        .publishModelBenchmarkFitnessSnapshot()
        .scores.find(({ modelId }) => modelId === "normalized-target")?.codingFitness,
      "number"
    );

    const invalidResponses = [
      {
        id: "all-rejected",
        model: "normalizer-current:free",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({ results: [{ ...validRow, model_id: "wrong-model" }] }),
            },
          },
        ],
      },
      {
        id: "empty-results",
        model: "normalizer-current:free",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ results: [] }) } }],
      },
      {
        id: "missing-content",
        model: "normalizer-current:free",
        choices: [{ finish_reason: "stop", message: {} }],
      },
      {
        id: "malformed-json",
        model: "normalizer-current:free",
        choices: [{ finish_reason: "stop", message: { content: "{" } }],
      },
      {
        id: "non-stop",
        model: "normalizer-current:free",
        choices: [
          { finish_reason: "length", message: { content: JSON.stringify({ results: [] }) } },
        ],
      },
    ];
    for (const response of invalidResponses) {
      normalizationResponse = response;
      db.prepare(
        `UPDATE model_benchmark_evidence
         SET verification_status = 'review_required'
         WHERE model_id = ? AND source = 'ollama-search-structured-output'`
      ).run("normalized-target");
      const retainedRows = normalizedRows();
      db.prepare(
        `UPDATE model_benchmark_search_models
         SET status = 'pending', normalization_status = 'not_started', attempts = 0,
             last_run_at = NULL, retry_after_at = NULL, last_error = NULL
         WHERE model_id = ?`
      ).run("normalized-target");
      await search.drainModelBenchmarkSearchQueue();
      assert.deepEqual(normalizedRows(), retainedRows);
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("a fresh running row schedules recovery at its stale boundary", async () => {
  searchDb.enqueueModelBenchmarkSearches([{ id: "stale-model", name: "Stale Model" }]);
  const db = core.getDbInstance();
  db.prepare(
    `UPDATE model_benchmark_search_models
     SET status = 'running', attempts = 1, last_run_at = ?
     WHERE model_id = ?`
  ).run(new Date().toISOString(), "stale-model");

  const originalSetTimeout = globalThis.setTimeout;
  let recoveryTimer: { callback: (...args: unknown[]) => void; delay: number } | null = null;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    const timer = originalSetTimeout(callback, delay, ...args);
    if (typeof delay === "number" && delay > 60_000) {
      recoveryTimer = { callback: () => callback(...args), delay };
    }
    return timer;
  }) as typeof globalThis.setTimeout;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url.includes("raw.githubusercontent.com/SWE-bench/"))
      return jsonResponse({ leaderboards: [] });
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url.includes("deepswe.datacurve.ai")) return jsonResponse({ rows: [] });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await search.drainModelBenchmarkSearchQueue();
    assert.ok(recoveryTimer);
    assert.ok((recoveryTimer as { delay: number }).delay > processor.NORMALIZATION_TIMEOUT_MS);
    assert.ok((recoveryTimer as { delay: number }).delay <= 25 * 60 * 1000);
    assert.equal(searchDb.listModelBenchmarkSearchRuns()[0].status, "running");

    db.prepare("UPDATE model_benchmark_search_models SET last_run_at = ? WHERE model_id = ?").run(
      new Date(Date.now() - 26 * 60 * 1000).toISOString(),
      "stale-model"
    );
    (recoveryTimer as { callback: () => void }).callback();
    const recovered = await waitFor(() => {
      const [run] = searchDb.listModelBenchmarkSearchRuns();
      return run.attempts === 2 && run.status === "source_error" ? run : null;
    });
    assert.ok(recovered);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});
