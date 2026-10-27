import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

async function importFreshModelsDevSync(label: string) {
  const modulePath = path.join(process.cwd(), "src/lib/modelsDevSync.ts");
  return import(`${pathToFileURL(modulePath).href}?case=${label}-${Date.now()}-${Math.random()}`);
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
      raw: {},
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
  assert.equal(parsed?.[0].value, 45);
  assert.equal(parsed?.[0].benchmark, "SWE-bench Verified");
  assert.equal(
    processor.parseNormalizationResponse(
      {
        ...response,
        choices: [
          {
            ...response.choices[0],
            message: {
              content: response.choices[0].message.content.replace('"value":45', '"value":0'),
            },
          },
        ],
      },
      model,
      searchResults
    ),
    null
  );
});

test("models.dev sync backfills all catalog IDs once, then queues new IDs", async () => {
  let catalog: Record<string, unknown> = {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: {
        "baseline-model": { id: "baseline-model", name: "Baseline Model", tool_call: true },
      },
    },
  };
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url === "https://models.dev/api.json") return jsonResponse(catalog);
    if (url.startsWith("https://raw.githubusercontent.com/SWE-bench/")) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url === "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json") {
      return jsonResponse({ rows: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const baselineSync = await importFreshModelsDevSync("benchmark-baseline");
  assert.equal((await baselineSync.syncModelsDev({ maxRetries: 0 })).success, true);
  assert.deepEqual(
    searchDb.listModelBenchmarkSearchRuns().map((run) => run.modelId),
    ["baseline-model"]
  );

  catalog = {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: {
        "baseline-model": { id: "baseline-model", name: "Baseline Model", tool_call: true },
        "dry-run-model": { id: "dry-run-model", name: "Dry Run Model", tool_call: true },
      },
    },
  };
  const dryRunSync = await importFreshModelsDevSync("benchmark-dry-run");
  assert.equal((await dryRunSync.syncModelsDev({ dryRun: true, maxRetries: 0 })).success, true);
  assert.deepEqual(
    searchDb.listModelBenchmarkSearchRuns().map((run) => run.modelId),
    ["baseline-model"]
  );

  const capabilitiesDisabledSync = await importFreshModelsDevSync("benchmark-no-capabilities");
  assert.equal(
    (await capabilitiesDisabledSync.syncModelsDev({ syncCapabilities: false, maxRetries: 0 }))
      .success,
    true
  );
  assert.deepEqual(
    searchDb.listModelBenchmarkSearchRuns().map((run) => run.modelId),
    ["baseline-model"]
  );

  catalog = {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: {
        "baseline-model": { id: "baseline-model", name: "Baseline Model", tool_call: true },
        "new-model": { id: "new-model", name: "New Model", tool_call: true },
        "new-model-2": { id: "new-model-2", name: "New Model 2", tool_call: true },
      },
    },
  };
  const newModelSync = await importFreshModelsDevSync("benchmark-new-model");
  assert.equal((await newModelSync.syncModelsDev({ maxRetries: 0 })).success, true);

  const processed = await waitFor(() => {
    const runs = searchDb
      .listModelBenchmarkSearchRuns()
      .filter((run) => ["new-model", "new-model-2"].includes(run.modelId));
    return runs.length === 2 && runs.every((run) => run.status !== "pending") ? runs : null;
  });
  assert.ok(processed);
  const processedRuns = processed as ReturnType<typeof searchDb.listModelBenchmarkSearchRuns>;
  assert.deepEqual(
    processedRuns.map((run) => [run.modelId, run.modelName, run.status]),
    [
      ["new-model", "New Model", "source_error"],
      ["new-model-2", "New Model 2", "source_error"],
    ]
  );
  for (const run of processedRuns) {
    assert.equal(run.normalizationStatus, "not_started");
    assert.equal(run.sourceStatus.artificialAnalysis.status, "error");
    assert.match(String(run.lastError), /API key is not configured/);
  }

  const repeatedSync = await importFreshModelsDevSync("benchmark-repeat-model");
  assert.equal((await repeatedSync.syncModelsDev({ maxRetries: 0 })).success, true);
  assert.equal(
    searchDb.listModelBenchmarkSearchRuns().filter((run) => run.modelId === "new-model").length,
    1
  );
  assert.equal(
    searchDb.listModelBenchmarkSearchRuns().filter((run) => run.modelId === "new-model-2").length,
    1
  );
  await search.drainModelBenchmarkSearchQueue();
});

test("first benchmark backfill includes IDs from an already-populated models.dev snapshot", async () => {
  const initialCatalog = {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: {
        "previous-model": { id: "previous-model", name: "Previous Model", tool_call: true },
      },
    },
  };
  const initialSync = await importFreshModelsDevSync("benchmark-existing-snapshot");
  initialSync.ensureCapabilitiesTable();
  initialSync.saveModelsDevCapabilities(
    initialSync.transformModelsDevToCapabilities(initialCatalog)
  );

  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    if (url === "https://models.dev/api.json") {
      return jsonResponse({
        openai: {
          id: "openai",
          name: "OpenAI",
          models: {
            "previous-model": { id: "previous-model", name: "Previous Model", tool_call: true },
            "current-model": { id: "current-model", name: "Current Model", tool_call: true },
          },
        },
      });
    }
    if (
      url ===
      "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json"
    ) {
      return jsonResponse({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return jsonResponse({ rows: [] });
    }
    if (url === "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json") {
      return jsonResponse({ rows: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const sync = await importFreshModelsDevSync("benchmark-full-backfill-existing");
  assert.equal((await sync.syncModelsDev({ maxRetries: 0 })).success, true);
  assert.deepEqual(
    searchDb
      .listModelBenchmarkSearchRuns(100)
      .map((run) => run.modelId)
      .sort(),
    ["current-model", "previous-model"]
  );
  await search.drainModelBenchmarkSearchQueue();
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
  assert.equal(firstBatchEvidence.length, 20);
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
  assert.equal(searchDb.listAllModelBenchmarkSearchEvidence().length, 21);
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

  assert.equal(searchDb.listModelBenchmarkSearchEvidence("vendor/model-a").length, 1);
  assert.equal(searchDb.listModelBenchmarkSearchEvidence("vendor/model-b").length, 0);
  assert.equal(searchDb.listModelBenchmarkSearchEvidence("Shared Model").length, 0);
});

test("complete AA and official miss runs HF and explicit free search, then stays unrated", async () => {
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
      return jsonResponse({ leaderboard: { name: body.name }, rows: [] });
    }
    if (url === "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json") {
      return jsonResponse({ generated_at: "2026-10-26T00:00:00Z", rows: [] });
    }
    if (url.startsWith("https://huggingface.co/api/models?")) {
      const query = new URL(url).searchParams.get("search");
      return jsonResponse(query === "new-model" ? [{ id: "new-model" }] : []);
    }
    if (url.startsWith("https://huggingface.co/api/models/new-model?")) {
      return jsonResponse({
        id: "new-model",
        evalResults: [{ dataset_id: "SWE-bench Verified", value: 0, verified: true }],
      });
    }
    if (url === "https://ollama.com/api/web_search") {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer ollama-search-test-key");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        query: '"new-model" benchmark evaluation reasoning effort',
        max_results: 10,
      });
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

  searchDb.enqueueModelBenchmarkSearches([{ id: "new-model", name: "New Model" }]);
  searchDb.enqueueModelBenchmarkSearches([{ id: "new-model", name: "New Model" }]);
  await search.drainModelBenchmarkSearchQueue();

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "review_required");
  assert.equal(run.normalizationStatus, "blocked_no_internal_api_key");
  assert.equal(run.sourceStatus.artificialAnalysis.status, "missing");
  assert.equal(run.sourceStatus.sweBench.status, "missing");
  assert.equal(run.sourceStatus.terminalBench20.status, "missing");
  assert.equal(run.sourceStatus.terminalBench21.status, "missing");
  assert.equal(run.sourceStatus.deepSwe.status, "missing");
  assert.equal(run.sourceStatus.ollamaSearch.provider, "ollama-search");
  assert.equal(run.sourceStatus.ollamaSearch.searchCostUsd, 0);
  assert.equal(run.sourceStatus.normalizationProcessor.status, "blocked_no_internal_api_key");
  assert.equal(run.sourceStatus.normalizationProcessor.candidateCount, 1);
  assert.equal(run.sourceStatus.normalizationProcessor.normalizerRequestCount, 0);
  assert.equal(searchDb.listModelBenchmarkSearchRuns().length, 1);
  assert.equal(urls.filter((url) => url === "https://ollama.com/api/web_search").length, 1);
  assert.equal(
    urls.some((url) => /searchapi|perplexity|tavily|exa\.ai/i.test(url)),
    false
  );

  const rows = searchDb.listModelBenchmarkSearchEvidence("new-model");
  const hfEvidence = rows.find((row) => row.source === "huggingface-eval-results");
  const webEvidence = rows.find((row) => row.source === "ollama-search");
  assert.ok(hfEvidence);
  assert.ok(webEvidence);
  assert.equal(hfEvidence.value, 0);
  assert.equal(hfEvidence.reasoningEffort, null);
  assert.equal(hfEvidence.reasoningConfig, null);
  assert.equal(hfEvidence.verificationStatus, "source_verified_review_required");
  assert.equal(webEvidence.value, null);
  assert.equal(webEvidence.matchedModelId, null);
  assert.equal(webEvidence.matchedModelName, null);
  assert.equal(webEvidence.verificationStatus, "candidate_review_required");

  assert.equal(
    searchDb.saveModelBenchmarkSearchEvidence([
      {
        ...hfEvidence,
        raw: hfEvidence.raw,
        reasoningConfig: hfEvidence.reasoningConfig,
      },
    ]),
    0
  );
  assert.equal(searchDb.listModelBenchmarkSearchEvidence("new-model").length, 2);
});

test("an incomplete official source blocks HF and web search", async () => {
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
    if (url.includes("huggingface.co")) {
      hfCalls += 1;
      return jsonResponse([]);
    }
    if (url === "https://ollama.com/api/web_search") {
      searchCalls += 1;
      return jsonResponse({ results: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  searchDb.enqueueModelBenchmarkSearches([{ id: "incomplete-model", name: "Incomplete Model" }]);
  await search.drainModelBenchmarkSearchQueue();

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "source_error");
  assert.equal(run.sourceStatus.artificialAnalysis.status, "incomplete");
  assert.equal(run.sourceStatus.terminalBench21.status, "error");
  assert.equal(aaCalls, 5);
  assert.equal(terminal21Calls, 2);
  assert.equal(hfCalls, 0);
  assert.equal(searchCalls, 0);
  assert.equal(searchDb.listModelBenchmarkSearchEvidence("incomplete-model").length, 0);
});

test("direct AA scores avoid search while retaining an exact official SWE row", async () => {
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
  await search.drainModelBenchmarkSearchQueue();

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "scored");
  assert.equal(run.sourceStatus.artificialAnalysis.status, "found");
  assert.equal(run.sourceStatus.sweBench.status, "found");
  const row = searchDb
    .listModelBenchmarkSearchEvidence("new-model")
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

test("a strict-SO timeout saves the row before the next model is claimed", async () => {
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

  let chatRequestStarted = false;
  let chatRequests = 0;
  const urls: string[] = [];
  const unexpectedUrls: string[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) =>
    originalSetTimeout(
      callback,
      delay === processor.NORMALIZATION_TIMEOUT_MS ? 30_000 : delay,
      ...args
    )) as typeof globalThis.setTimeout;

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
        ["z-next-model", "unrated_no_evidence"],
      ]
    );
    const completedSlow = runs.find((run) => run.modelId === "a-slow-model");
    assert.ok(completedSlow);
    assert.equal(completedSlow.normalizationStatus, "normalization_timeout_unrated");
    assert.match(completedSlow.lastError ?? "", /Strict-SO normalization timed out/);
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
    assert.equal(urls.filter((url) => url === "https://ollama.com/api/web_search").length, 2);
  } finally {
    await drain?.catch(() => undefined);
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
    assert.ok((recoveryTimer as { delay: number }).delay > 0);
    assert.ok((recoveryTimer as { delay: number }).delay <= 15 * 60 * 1000);
    assert.equal(searchDb.listModelBenchmarkSearchRuns()[0].status, "running");

    db.prepare("UPDATE model_benchmark_search_models SET last_run_at = ? WHERE model_id = ?").run(
      new Date(Date.now() - 16 * 60 * 1000).toISOString(),
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
