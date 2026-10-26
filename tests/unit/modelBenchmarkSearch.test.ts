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
const providersDb = await import("../../src/lib/db/providers.ts");
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

function openRouterEndpointMetadata() {
  return {
    data: {
      id: processor.NORMALIZATION_MODEL,
      endpoints: [
        {
          model_id: processor.NORMALIZATION_MODEL,
          provider_name: "Phala",
          tag: "phala",
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: ["response_format", "structured_outputs"],
        },
      ],
    },
  };
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

test("normalization connection choice requires exact free model and is deterministic", () => {
  const result = processor.selectFreeNormalizationConnection(
    [
      { id: "z-connection", models: [{ id: processor.NORMALIZATION_MODEL, isFree: true }] },
      { id: "a-paid-only", models: [{ id: processor.NORMALIZATION_MODEL, isFree: false }] },
      { id: "different-model", models: [{ id: "different/model:free", isFree: true }] },
    ],
    processor.NORMALIZATION_MODEL
  );

  assert.equal(result, "z-connection");
  assert.equal(
    processor.selectFreeNormalizationConnection([], processor.NORMALIZATION_MODEL),
    null
  );
});

test("normalization selects active OpenRouter connection stored with apikey auth type", async () => {
  const connectionId = "openrouter-free-test";
  const db = core.getDbInstance();
  db.prepare(
    `INSERT INTO provider_connections
     (id, provider, auth_type, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    connectionId,
    "openrouter",
    "apikey",
    "OpenRouter test connection",
    1,
    "2026-10-26T00:00:00Z",
    "2026-10-26T00:00:00Z"
  );
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    "syncedAvailableModels",
    `openrouter:${connectionId}`,
    JSON.stringify([{ id: processor.NORMALIZATION_MODEL, isFree: true }])
  );

  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    requests.push(url);
    assert.equal(
      url,
      "https://openrouter.ai/api/v1/models/xingchen-agi/xing4.0-29b-a4b:free/endpoints"
    );
    return jsonResponse(openRouterEndpointMetadata());
  };

  const result = await processor.processModelBenchmarkSearchResults(
    { id: "new-model", name: "New Model" },
    [{ url: "https://example.org/benchmark" }]
  );

  assert.equal(result.status, "blocked_no_internal_api_key");
  assert.equal(result.connectionId, connectionId);
  assert.equal(result.endpointMetadataVerified, true);
  assert.equal(result.attemptCount, 0);
  assert.equal(requests.length, 1);
});

test("normalization requires one current zero-cost Phala strict-SO endpoint", () => {
  const metadata = openRouterEndpointMetadata();
  assert.equal(processor.isNormalizationEndpointVerified(metadata), true);
  assert.equal(
    processor.isNormalizationEndpointVerified({
      data: {
        ...metadata.data,
        endpoints: [
          {
            ...metadata.data.endpoints[0],
            pricing: { prompt: "0.000001", completion: "0" },
          },
        ],
      },
    }),
    false
  );
  assert.equal(
    processor.isNormalizationEndpointVerified({
      data: {
        ...metadata.data,
        endpoints: [...metadata.data.endpoints, metadata.data.endpoints[0]],
      },
    }),
    false
  );
});

test("normalization request pins Phala with strict schema and forbids upstream fallback", () => {
  const searchResults = [{ url: "https://example.org/report", title: "New Model benchmark" }];
  const body = processor.buildNormalizationRequest("new-model", "New Model", searchResults);

  assert.equal(body.model, processor.NORMALIZATION_ROUTED_MODEL);
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.deepEqual(JSON.parse(messages[1].content), {
    model_id: "new-model",
    model_name: "New Model",
    search_results: searchResults,
  });
  assert.deepEqual(body.provider, {
    only: ["phala"],
    require_parameters: true,
    allow_fallbacks: false,
  });
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

test("normalization resolves to OpenRouter and preserves strict schema controls", async () => {
  const request = processor.buildNormalizationRequest("new-model", "New Model", []);
  const route = await chatHelpers.resolveModelOrError(String(request.model), { stream: false });
  assert.equal(route.provider, "openrouter");
  assert.equal(route.model, processor.NORMALIZATION_MODEL);

  const transformed = new DefaultExecutor(route.provider).transformRequest(
    route.model,
    { ...request, model: route.model },
    false,
    {}
  );

  assert.deepEqual(transformed.response_format, request.response_format);
  assert.deepEqual(transformed.provider, request.provider);
  assert.equal(transformed.model, processor.NORMALIZATION_MODEL);
});

test("internal benchmark chat pins one account and exits before global fallback", () => {
  const chatSource = fs.readFileSync(path.join(process.cwd(), "src/sse/handlers/chat.ts"), "utf8");
  const dispatch = chatSource.indexOf(
    "const oneShotBenchmarkChat = oneShotBenchmarkChatRequests.get(request)"
  );
  const dispatchEnd = chatSource.indexOf("let managedLease", dispatch);
  const globalFallback = chatSource.indexOf("Global Fallback Provider (#689)");
  const oneShotDispatch = chatSource.slice(dispatch, dispatchEnd);

  assert.ok(dispatch >= 0);
  assert.ok(globalFallback > dispatchEnd);
  assert.match(oneShotDispatch, /sessionId: null/);
  assert.match(oneShotDispatch, /sessionAffinityKey: null/);
  assert.match(oneShotDispatch, /forcedConnectionId: oneShotBenchmarkChat\.connectionId/);
  assert.match(oneShotDispatch, /emergencyFallbackTried: true/);
  assert.match(oneShotDispatch, /skipUpstreamRetry: true/);
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
    if (url === "https://openrouter.ai/api/v1/models/xingchen-agi/xing4.0-29b-a4b:free/endpoints") {
      return jsonResponse(openRouterEndpointMetadata());
    }
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
  assert.equal(run.normalizationStatus, "blocked_no_exact_free_connection");
  assert.equal(run.sourceStatus.artificialAnalysis.status, "missing");
  assert.equal(run.sourceStatus.sweBench.status, "missing");
  assert.equal(run.sourceStatus.terminalBench20.status, "missing");
  assert.equal(run.sourceStatus.terminalBench21.status, "missing");
  assert.equal(run.sourceStatus.deepSwe.status, "missing");
  assert.equal(run.sourceStatus.ollamaSearch.provider, "ollama-search");
  assert.equal(run.sourceStatus.ollamaSearch.searchCostUsd, 0);
  assert.equal(run.sourceStatus.normalizationProcessor.status, "blocked_no_exact_free_connection");
  assert.equal(run.sourceStatus.normalizationProcessor.candidateCount, 1);
  assert.equal(run.sourceStatus.normalizationProcessor.endpointMetadataVerified, true);
  assert.equal(typeof run.sourceStatus.normalizationProcessor.endpointMetadataCheckedAt, "string");
  assert.equal(run.sourceStatus.normalizationProcessor.attemptCount, 0);
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
