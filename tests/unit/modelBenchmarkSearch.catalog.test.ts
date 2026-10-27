import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-benchmark-catalog-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.AA_API_KEY = "catalog-test-key";
const core = await import("../../src/lib/db/core.ts");
const searchDb = await import("../../src/lib/db/modelBenchmarkSearch.ts");
const search = await import("../../src/lib/modelBenchmarkSearch.ts");
const fitnessSync = await import("../../src/lib/modelBenchmarkFitnessSync.ts");

const catalog = [
  { id: "Vendor/Raw-1", name: "Model One" },
  { id: "Vendor/Inactive", name: "Inactive Model" },
  { id: "Vendor/Ambiguous-A", name: "Shared Display" },
  { id: "Vendor/Ambiguous-B", name: "Shared Display" },
];

function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", date: "Tue, 27 Oct 2026 00:00:00 GMT" },
  });
}

function feedFetch(
  options: {
    aaValue?: number;
    inactiveAaValue?: number;
    terminalRows20?: unknown[];
    terminalRows21?: unknown[];
    invalidDeepSwe?: boolean;
    invalidTerminal?: boolean;
    emptyAa?: boolean;
    incompleteAa?: boolean;
    failedSwe?: boolean;
  } = {}
) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let aaRowsServed = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({ url, init });
    if (url.includes("artificialanalysis.ai/api/v2/language/models/free")) {
      const page = Number(new URL(url).searchParams.get("page"));
      const pageSizes = [180, 180, 180, 175];
      const data = options.emptyAa
        ? []
        : Array.from({ length: pageSizes[page - 1] }, (_, index) => ({
            slug: `unlisted-${page}-${index}`,
            name: `Unlisted ${page}-${index}`,
            evaluations: {
              artificial_analysis_coding_index: index,
              artificial_analysis_intelligence_index: index,
            },
          }));
      if (page === 4 && !options.emptyAa) {
        data[0] = {
          slug: "Vendor/Raw-1",
          name: "Model One",
          evaluations: {
            artificial_analysis_coding_index: options.aaValue ?? 42,
            artificial_analysis_intelligence_index: 37,
          },
        };
        data[1] = {
          slug: "Vendor/Inactive",
          name: "Inactive Model",
          evaluations: {
            artificial_analysis_coding_index: options.inactiveAaValue ?? 20,
            artificial_analysis_intelligence_index: 30,
          },
        };
      }
      aaRowsServed += data.length;
      return jsonResponse({
        data,
        intelligence_index_version: 4.1,
        pagination: { has_more: page < 4 || options.incompleteAa === true },
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      if (options.failedSwe) return jsonResponse({ error: "unavailable" }, 503);
      return jsonResponse({
        leaderboards: [
          {
            name: "Verified",
            results: [
              {
                model_id: "Vendor/Raw-1",
                model_display: "Model One",
                reasoning_effort: "high",
                config: "agent-a",
                resolved: 0.61,
              },
              { model_display: "Inactive Model", resolved: 0.22 },
              { model_display: "Model One (high)", resolved: 0.3 },
              { model_display: "Shared Display", resolved: 0.9 },
            ],
          },
        ],
      });
    }
    if (url.includes("supabase.co/functions/v1/leaderboard-read")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { name?: string };
      if (options.invalidTerminal) return jsonResponse({ rows: null });
      if (body.name === "main")
        return jsonResponse({
          rows: options.terminalRows21 ?? [
            {
              metadata: {
                model_id: "Vendor/Raw-1",
                model_display: { label: "Model One" },
                reasoning_effort: "high",
                config: { agent: "agent-a", harness: "harness-a" },
              },
              metrics: { accuracy: 0.72 },
            },
            {
              metadata: {
                model_id: "Vendor/Raw-1",
                model_display: { label: "Model One" },
                reasoning_effort: "low",
                config: { agent: "agent-b", harness: "harness-b" },
              },
              metrics: { accuracy: 0.68 },
            },
            {
              metadata: {
                model_id: "Vendor/Raw-1",
                model_display: { label: "Model One" },
                reasoning_effort: "high",
                config: { agent: "agent-a", harness: "harness-a" },
              },
              metrics: { accuracy: 0.72 },
            },
          ],
        });
      return jsonResponse({
        rows: options.terminalRows20 ?? [
          {
            metadata: {
              model_id: "Vendor/Raw-1",
              model_display: { label: "Model One" },
              reasoning_effort: "medium",
              config: { agent: "agent-20" },
            },
            metrics: { accuracy: 0.63 },
          },
        ],
      });
    }
    if (url.includes("deepswe.datacurve.ai")) {
      return jsonResponse(
        options.invalidDeepSwe
          ? { rows: null }
          : {
              generated_at: "2026-10-26T00:00:00Z",
              rows: [
                {
                  model: "Vendor/Raw-1",
                  reasoning_effort: "high",
                  config: "agent-a",
                  pass_rate: 0.57,
                },
              ],
            }
      );
    }
    throw new Error(`Unexpected benchmark source request: ${url}`);
  };
  return {
    fetchImpl,
    requests,
    get aaRowsServed() {
      return aaRowsServed;
    },
  };
}

function currentRows() {
  return searchDb.listAllModelBenchmarkSearchEvidence().map((row) => ({
    modelId: row.modelId,
    matchedModelId: row.matchedModelId,
    source: row.source,
    benchmark: row.benchmark,
    benchmarkVersion: row.benchmarkVersion,
    effort: row.reasoningEffort,
    config: row.reasoningConfig,
    metric: row.metric,
    value: row.value,
  }));
}

function benchmarkFitnessRows() {
  return core
    .getDbInstance()
    .prepare(
      `SELECT model, source, category, score, confidence FROM model_intelligence
       WHERE source LIKE 'benchmark_fitness%' ORDER BY model, source, category`
    )
    .all();
}

test.beforeEach(() => {
  resetStorage();
  searchDb.upsertModelBenchmarkSearchIdentities(catalog);
});
test.afterEach(() => core.resetDbInstance());
test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("refreshes all canonical models from complete feeds, including inactive models", async () => {
  const fixture = feedFetch();
  const { fetchImpl, requests } = fixture;
  searchDb.replaceModelBenchmarkEvidenceSources([
    {
      modelId: "Vendor/Raw-1",
      source: "huggingface-eval-results",
      rows: [
        {
          evidenceHash: "hf-keep",
          modelId: "Vendor/Raw-1",
          source: "huggingface-eval-results",
          sourceVersion: "test",
          matchedModelId: "Vendor/Raw-1",
          matchedModelName: "Model One",
          benchmark: "SWE-bench",
          benchmarkVersion: "Verified",
          reasoningEffort: "high",
          reasoningConfig: null,
          metric: "resolved",
          value: 0.5,
          sourceUrl: "https://huggingface.co/test",
          sourceDate: null,
          verificationStatus: "verified",
          capturedAt: new Date().toISOString(),
        },
      ],
    },
  ]);

  await search.refreshModelBenchmarkCatalogEvidence([...catalog, { ...catalog[0] }], fetchImpl);

  const rows = currentRows();
  assert.equal(
    searchDb.listModelBenchmarkSearchCatalogModels().filter(({ id }) => id === "Vendor/Raw-1")
      .length,
    1
  );
  assert.ok(
    rows.some(
      (row) =>
        row.modelId === "Vendor/Raw-1" &&
        row.source === "artificial-analysis-free" &&
        row.metric === "artificial_analysis_coding_index" &&
        row.value === 42
    )
  );
  assert.ok(
    rows.some(
      (row) =>
        row.modelId === "Vendor/Raw-1" &&
        row.matchedModelId === "Vendor/Raw-1" &&
        row.source === "artificial-analysis-free"
    )
  );
  assert.ok(
    rows.some(
      (row) =>
        row.modelId === "Vendor/Raw-1" &&
        row.source === "artificial-analysis-free" &&
        row.metric === "artificial_analysis_intelligence_index" &&
        row.value === 37
    )
  );
  assert.ok(
    rows.some(
      (row) => row.modelId === "Vendor/Inactive" && row.source === "artificial-analysis-free"
    )
  );
  assert.ok(rows.some((row) => row.modelId === "Vendor/Inactive" && row.source === "swe-bench"));
  assert.ok(rows.some((row) => row.modelId === "Vendor/Raw-1" && row.source === "swe-bench"));
  assert.ok(
    rows.some((row) => row.modelId === "Vendor/Raw-1" && row.source === "terminal-bench-2.0")
  );
  assert.ok(
    rows.some((row) => row.modelId === "Vendor/Raw-1" && row.source === "terminal-bench-2.1")
  );
  assert.ok(rows.some((row) => row.modelId === "Vendor/Raw-1" && row.source === "deepswe"));
  assert.ok(
    rows.some((row) => row.modelId === "Vendor/Raw-1" && row.source === "huggingface-eval-results")
  );
  assert.equal(
    rows.some((row) => row.modelId.startsWith("openrouter/")),
    false
  );
  assert.equal(
    rows.some((row) => row.matchedModelName === "Model One (high)"),
    false
  );
  assert.equal(
    rows.some((row) => row.modelId.startsWith("Vendor/Ambiguous-")),
    false
  );

  const terminalRows = rows.filter(
    (row) => row.modelId === "Vendor/Raw-1" && row.source === "terminal-bench-2.1"
  );
  assert.deepEqual(terminalRows.map(({ effort, config }) => [effort, config]).sort(), [
    ["high", { agent: "agent-a", harness: "harness-a" }],
    ["low", { agent: "agent-b", harness: "harness-b" }],
  ]);
  assert.equal(requests.filter(({ url }) => url.includes("artificialanalysis.ai")).length, 4);
  assert.deepEqual(
    requests
      .filter(({ url }) => url.includes("artificialanalysis.ai"))
      .map(({ url }) => new URL(url).searchParams.get("page")),
    ["1", "2", "3", "4"]
  );
  assert.equal(requests.filter(({ url }) => url.includes("artificialanalysis.ai")).length, 4);
  assert.equal(fixture.aaRowsServed, 715);
  assert.equal(
    requests.some(
      ({ url }) => url.includes("huggingface.co") || url.includes("ollama.com/api/web_search")
    ),
    false
  );
});

test("a recognized source ID takes precedence over another model's display name", async () => {
  await search.refreshModelBenchmarkCatalogEvidence(
    [
      { id: "Vendor/Raw-1", name: "Alias One" },
      { id: "Vendor/Inactive", name: "Model One" },
    ],
    feedFetch().fetchImpl
  );

  const rows = currentRows();
  assert.ok(
    rows.some(
      ({ modelId, source, metric, value }) =>
        modelId === "Vendor/Raw-1" &&
        source === "artificial-analysis-free" &&
        metric === "artificial_analysis_coding_index" &&
        value === 42
    )
  );
  assert.ok(
    rows.some(
      ({ modelId, source, value }) =>
        modelId === "Vendor/Raw-1" && source === "swe-bench" && value === 0.61
    )
  );
  assert.equal(
    rows.some(
      ({ modelId, source, value }) =>
        modelId === "Vendor/Inactive" &&
        ((source === "artificial-analysis-free" && value === 42) ||
          (source === "swe-bench" && value === 0.61))
    ),
    false
  );
});

test("successful refresh replaces changed and deleted current observations", async () => {
  const first = feedFetch();
  await search.refreshModelBenchmarkCatalogEvidence([catalog[0]], first.fetchImpl);
  assert.ok(
    currentRows().some((row) => row.source === "terminal-bench-2.1" && row.effort === "low")
  );

  const second = feedFetch({
    aaValue: 55,
    terminalRows21: [
      {
        metadata: {
          model_id: "Vendor/Raw-1",
          model_display: { label: "Model One" },
          reasoning_effort: "high",
          config: { agent: "agent-a", harness: "harness-a" },
        },
        metrics: { accuracy: 0.81 },
      },
    ],
  });
  await search.refreshModelBenchmarkCatalogEvidence([catalog[0]], second.fetchImpl);

  const rows = currentRows();
  assert.equal(
    rows.find(
      (row) =>
        row.source === "artificial-analysis-free" &&
        row.metric === "artificial_analysis_coding_index"
    )?.value,
    55
  );
  assert.equal(rows.filter((row) => row.source === "terminal-bench-2.1").length, 1);
  assert.equal(rows.find((row) => row.source === "terminal-bench-2.1")?.value, 0.81);
});

test("refresh clears every evidence source and native score for IDs removed from catalog", async () => {
  searchDb.upsertModelBenchmarkSearchIdentities([{ id: "Vendor/Retired", name: "Retired Model" }]);
  searchDb.replaceModelBenchmarkEvidenceSources([
    {
      modelId: "Vendor/Retired",
      source: "swe-bench",
      rows: [
        {
          evidenceHash: "retired-swe",
          modelId: "Vendor/Retired",
          source: "swe-bench",
          sourceVersion: "old",
          matchedModelId: "Vendor/Retired",
          matchedModelName: "Retired Model",
          benchmark: "SWE-bench",
          benchmarkVersion: "Verified",
          reasoningEffort: null,
          reasoningConfig: null,
          metric: "resolved",
          value: 0.4,
          sourceUrl: "https://example.test/old",
          sourceDate: null,
          verificationStatus: "official_leaderboard",
          capturedAt: new Date().toISOString(),
        },
      ],
    },
    {
      modelId: "Vendor/Retired",
      source: "huggingface-eval-results",
      rows: [
        {
          evidenceHash: "retired-hf",
          modelId: "Vendor/Retired",
          source: "huggingface-eval-results",
          sourceVersion: "test",
          matchedModelId: "Vendor/Retired",
          matchedModelName: "Retired Model",
          benchmark: "SWE-bench Verified",
          benchmarkVersion: "v1",
          reasoningEffort: "high",
          reasoningConfig: null,
          metric: "resolved",
          value: 0.4,
          sourceUrl: "https://huggingface.co/retired",
          sourceDate: null,
          verificationStatus: "source_verified_review_required",
          capturedAt: new Date().toISOString(),
        },
      ],
    },
    {
      modelId: catalog[0].id,
      source: "huggingface-eval-results",
      rows: [
        {
          evidenceHash: "current-hf-peer",
          modelId: catalog[0].id,
          source: "huggingface-eval-results",
          sourceVersion: "test",
          matchedModelId: catalog[0].id,
          matchedModelName: catalog[0].name,
          benchmark: "SWE-bench Verified",
          benchmarkVersion: "v1",
          reasoningEffort: "high",
          reasoningConfig: null,
          metric: "resolved",
          value: 0.8,
          sourceUrl: "https://huggingface.co/current",
          sourceDate: null,
          verificationStatus: "source_verified_review_required",
          capturedAt: new Date().toISOString(),
        },
      ],
    },
  ]);
  fitnessSync.publishModelBenchmarkFitnessSnapshot();
  const retiredScores = () =>
    core
      .getDbInstance()
      .prepare(
        `SELECT model, source, category, score FROM model_intelligence
         WHERE model = 'vendor/retired' AND source LIKE 'benchmark_fitness%'
         ORDER BY source, category`
      )
      .all();
  assert.ok(retiredScores().length > 0);

  await search.refreshModelBenchmarkCatalogEvidence(catalog, feedFetch().fetchImpl);

  assert.equal(searchDb.listModelBenchmarkSearchEvidence("Vendor/Retired").length, 0);
  assert.deepEqual(retiredScores(), []);
  assert.ok(
    searchDb
      .listModelBenchmarkSearchEvidence(catalog[0].id)
      .some((row) => row.source === "huggingface-eval-results")
  );
});

test("catalog refresh calls serialize in invocation order and the later catalog wins", async () => {
  const firstFixture = feedFetch();
  const secondFixture = feedFetch({ inactiveAaValue: 29 });
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let firstCalls = 0;
  let secondCalls = 0;
  const firstFetch: typeof fetch = async (input, init) => {
    firstCalls += 1;
    markFirstStarted();
    await firstGate;
    return firstFixture.fetchImpl(input, init);
  };
  const secondFetch: typeof fetch = async (input, init) => {
    secondCalls += 1;
    return secondFixture.fetchImpl(input, init);
  };

  const firstRefresh = search.refreshModelBenchmarkCatalogEvidence(
    [{ id: "Vendor/Raw-1", name: "Model One" }],
    firstFetch
  );
  await firstStarted;
  const secondRefresh = search.refreshModelBenchmarkCatalogEvidence(
    [{ id: "Vendor/Inactive", name: "Inactive Model" }],
    secondFetch
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondCalls, 0);

  releaseFirst();
  await firstRefresh;
  await secondRefresh;

  assert.ok(firstCalls > 0);
  assert.ok(secondCalls > 0);
  const rows = currentRows();
  assert.equal(
    rows.some(({ modelId }) => modelId === "Vendor/Raw-1"),
    false
  );
  assert.ok(rows.some(({ modelId, value }) => modelId === "Vendor/Inactive" && value === 29));
});

test("a rejected catalog refresh releases the queue for the next call", async () => {
  const firstFixture = feedFetch();
  const secondFixture = feedFetch();
  let rejectFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    rejectFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let failNext = true;
  let secondCalls = 0;
  const firstFetch: typeof fetch = async (input, init) => {
    if (failNext) {
      failNext = false;
      markFirstStarted();
      await firstGate;
      throw new Error("offline fixture failure");
    }
    return firstFixture.fetchImpl(input, init);
  };
  const secondFetch: typeof fetch = async (input, init) => {
    secondCalls += 1;
    return secondFixture.fetchImpl(input, init);
  };

  const firstRefresh = search.refreshModelBenchmarkCatalogEvidence(
    [{ id: "Vendor/Raw-1", name: "Model One" }],
    firstFetch
  );
  await firstStarted;
  const secondRefresh = search.refreshModelBenchmarkCatalogEvidence(
    [{ id: "Vendor/Inactive", name: "Inactive Model" }],
    secondFetch
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondCalls, 0);

  rejectFirst();
  await assert.rejects(firstRefresh, /offline fixture failure/);
  await secondRefresh;
  assert.ok(secondCalls > 0);
  assert.ok(currentRows().some(({ modelId }) => modelId === "Vendor/Inactive"));
});

test("invalid source feed leaves previous current evidence and scores untouched", async () => {
  const valid = feedFetch();
  await search.refreshModelBenchmarkCatalogEvidence([catalog[0]], valid.fetchImpl);
  const before = currentRows();
  const beforeFitness = benchmarkFitnessRows();

  const invalid = feedFetch({ aaValue: 99, invalidDeepSwe: true });
  await search
    .refreshModelBenchmarkCatalogEvidence([catalog[0]], invalid.fetchImpl)
    .catch(() => undefined);

  assert.deepEqual(currentRows(), before);
  assert.deepEqual(benchmarkFitnessRows(), beforeFitness);
  assert.equal(
    invalid.requests.filter(({ url }) => url.includes("artificialanalysis.ai")).length,
    4
  );
});

test("feed errors, empty snapshots, malformed payloads, and incomplete pagination preserve current evidence", async () => {
  const valid = feedFetch();
  await search.refreshModelBenchmarkCatalogEvidence([catalog[0]], valid.fetchImpl);
  const before = currentRows();
  const beforeFitness = benchmarkFitnessRows();
  const cases = [
    feedFetch({ failedSwe: true }),
    feedFetch({ emptyAa: true }),
    feedFetch({ invalidTerminal: true }),
    feedFetch({ incompleteAa: true }),
  ];

  for (const fixture of cases) {
    await search
      .refreshModelBenchmarkCatalogEvidence([catalog[0]], fixture.fetchImpl)
      .catch(() => undefined);
    assert.deepEqual(currentRows(), before);
    assert.deepEqual(benchmarkFitnessRows(), beforeFitness);
  }
});
