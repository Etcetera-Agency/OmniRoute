import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TEST_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "omniroute-models-dev-benchmark-hook-")
);
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const benchmarkSearchDb = await import("../../src/lib/db/modelBenchmarkSearch.ts");
await import("../../src/lib/modelBenchmarkSearch.ts");
const modulePath = path.join(process.cwd(), "src/lib/modelsDevSync.ts");
const originalFetch = globalThis.fetch;
const originalAaApiKey = process.env.AA_API_KEY;
const originalModelsDevSyncEnabled = process.env.MODELS_DEV_SYNC_ENABLED;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

const MODELS_DEV_DATA = {
  openai: {
    id: "openai",
    models: {
      "gpt-hook-test": {
        id: "gpt-hook-test",
        name: "GPT Hook Test",
        tool_call: true,
        reasoning: false,
        attachment: true,
        structured_output: true,
        temperature: true,
        release_date: "2026-01-01",
        last_updated: "2026-01-01",
        open_weights: false,
        cost: { input: 1, output: 2 },
        limit: { context: 8192, output: 1024 },
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
};

async function importFresh(label) {
  const mod = await import(
    `${pathToFileURL(modulePath).href}?benchmark-hook=${label}-${Date.now()}-${Math.random()}`
  );
  return mod;
}

function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

test.describe("modelsDevSync benchmark hook", { concurrency: 1 }, async () => {
  test.beforeEach(() => resetStorage());

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (originalAaApiKey === undefined) delete process.env.AA_API_KEY;
    else process.env.AA_API_KEY = originalAaApiKey;
    if (originalModelsDevSyncEnabled === undefined) delete process.env.MODELS_DEV_SYNC_ENABLED;
    else process.env.MODELS_DEV_SYNC_ENABLED = originalModelsDevSyncEnabled;
    core.resetDbInstance();
  });

  test.after(() => {
    core.resetDbInstance();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test("syncModelsDev refreshes current benchmark evidence after saving catalog and isolates source failures", async () => {
    delete process.env.AA_API_KEY;
    const requestedUrls = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === "https://models.dev/api.json") {
        return new Response(JSON.stringify(MODELS_DEV_DATA), { status: 200 });
      }
      if (
        url.includes("artificialanalysis.ai") ||
        url.includes("raw.githubusercontent.com/SWE-bench/") ||
        url.includes("ofhuhcpkvzjlejydnvyd.supabase.co") ||
        url.includes("deepswe.datacurve.ai")
      ) {
        throw new Error("benchmark source unavailable");
      }
      throw new Error(`Unexpected local sync request: ${url}`);
    };

    const modelsDev = await importFresh("source-failure");
    const result = await modelsDev.syncModelsDev({ maxRetries: 0 });
    assert.equal(result.success, true);
    assert.ok(result.modelCount > 0);
    assert.ok(result.capabilityCount > 0);
    assert.equal(await waitFor(() => requestedUrls.length === 5), true);
    assert.equal(modelsDev.getModelsDevPricing().openai["gpt-hook-test"].input, 1);
    assert.equal(modelsDev.getSyncedCapabilities().openai["gpt-hook-test"].tool_call, true);

    assert.ok(requestedUrls.includes("https://models.dev/api.json"));
    assert.ok(
      requestedUrls.every(
        (url) =>
          url === "https://models.dev/api.json" ||
          url.includes("artificialanalysis.ai") ||
          url.includes("raw.githubusercontent.com/SWE-bench/") ||
          url.includes("ofhuhcpkvzjlejydnvyd.supabase.co") ||
          url.includes("deepswe.datacurve.ai")
      )
    );
    assert.equal(
      requestedUrls.some((url) => url.includes("artificialanalysis.ai")),
      false
    );
    const queueCount = core
      .getDbInstance()
      .prepare("SELECT COUNT(*) AS count FROM model_benchmark_search_models")
      .get().count;
    assert.equal(queueCount, 0);
  });

  test("syncCapabilities=false skips benchmark refresh", async () => {
    const requestedUrls = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      return new Response(JSON.stringify(MODELS_DEV_DATA), { status: 200 });
    };

    const modelsDev = await importFresh("capabilities-disabled");
    const result = await modelsDev.syncModelsDev({ syncCapabilities: false, maxRetries: 0 });

    assert.equal(result.success, true);
    assert.equal(result.capabilityCount, 0);
    assert.ok(requestedUrls.every((url) => url === "https://models.dev/api.json"));
    assert.equal(modelsDev.getModelsDevPricing().openai["gpt-hook-test"].input, 1);
    assert.deepEqual(modelsDev.getSyncedCapabilities(), {});
  });

  test("saved startup opt-in runs one immediate sync and async benchmark metadata refresh", async () => {
    delete process.env.MODELS_DEV_SYNC_ENABLED;
    process.env.AA_API_KEY = "fixture-only";
    await settingsDb.updateSettings({ modelsDevSyncEnabled: true, modelsDevSyncInterval: 60_000 });

    const intervalRegistrations: number[] = [];
    globalThis.setInterval = ((_callback, intervalMs) => {
      intervalRegistrations.push(intervalMs);
      return { unref() {} };
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = (() => {}) as typeof clearInterval;

    const modelId = "startup-zero-price-model";
    const catalogData = {
      openai: {
        id: "openai",
        models: {
          [modelId]: {
            id: modelId,
            name: "Startup Zero Price Model",
            tool_call: true,
            reasoning: false,
            attachment: true,
            structured_output: true,
            temperature: true,
            release_date: "2026-10-01",
            last_updated: "2026-10-01",
            open_weights: true,
            cost: { input: 0, output: 0 },
            limit: { context: 8192, output: 1024 },
            modalities: { input: ["text"], output: ["text"] },
          },
        },
      },
    };
    const requestUrls: string[] = [];
    const unexpectedUrls: string[] = [];
    let aaRequestStarted = false;
    let releaseAaResponse: (response: Response) => void = () => {};
    const aaResponse = new Promise<Response>((resolve) => {
      releaseAaResponse = resolve;
    });
    globalThis.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      requestUrls.push(url);
      if (url === "https://models.dev/api.json") {
        return new Response(JSON.stringify(catalogData), { status: 200 });
      }
      if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
        aaRequestStarted = true;
        return aaResponse;
      }
      if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
        return new Response(JSON.stringify({ leaderboards: [] }), { status: 200 });
      }
      if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }
      if (url.includes("deepswe.datacurve.ai")) {
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }
      unexpectedUrls.push(url);
      throw new Error(`Unexpected startup fetch: ${url}`);
    };

    const db = core.getDbInstance();
    db.exec(
      "CREATE TABLE startup_zero_price_write_count (writes INTEGER NOT NULL); " +
        "INSERT INTO startup_zero_price_write_count VALUES (0); " +
        "CREATE TRIGGER count_startup_zero_price_write AFTER INSERT ON key_value " +
        "WHEN NEW.namespace = 'models_dev_zero_price' AND NEW.key = 'snapshot' " +
        "BEGIN UPDATE startup_zero_price_write_count SET writes = writes + 1; END;"
    );

    const modelsDev = await importFresh("startup-saved-enabled");
    try {
      await modelsDev.initModelsDevSync();
      await modelsDev.initModelsDevSync();

      assert.equal(modelsDev.getSyncStatus().enabled, true);
      assert.deepEqual(intervalRegistrations, [60_000]);
      assert.equal(await waitFor(() => Boolean(modelsDev.getSyncStatus().lastSync), 10_000), true);
      assert.equal(await waitFor(() => aaRequestStarted, 10_000), true);
      assert.equal(requestUrls.filter((url) => url === "https://models.dev/api.json").length, 1);
      assert.equal(
        requestUrls.filter((url) => url.startsWith("https://artificialanalysis.ai/")).length,
        1
      );
      assert.equal(unexpectedUrls.length, 0);
      assert.equal(db.prepare("SELECT writes FROM startup_zero_price_write_count").get().writes, 1);
      assert.deepEqual(modelsDev.getModelsDevZeroPriceEvidence()?.modelsByProvider.openai, [
        modelId,
      ]);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM model_benchmark_search_models").get().count,
        0
      );

      releaseAaResponse(
        new Response(
          JSON.stringify({
            intelligence_index_version: 4.1,
            pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
            data: [
              {
                slug: modelId,
                name: "Startup Zero Price Model",
                release_date: "2026-10-01",
                evaluations: {
                  artificial_analysis_coding_index: 60,
                  artificial_analysis_intelligence_index: 70,
                },
              },
            ],
          }),
          { status: 200, headers: { date: "Sat, 31 Oct 2026 00:00:00 GMT" } }
        )
      );
      assert.equal(
        await waitFor(
          () =>
            db.prepare("SELECT COUNT(*) AS count FROM model_benchmark_search_models").get()
              .count === 1,
          10_000
        ),
        true
      );
      assert.deepEqual(
        benchmarkSearchDb
          .listAllModelBenchmarkSearchEvidenceForModel(modelId)
          .filter((row) => row.source === "artificial-analysis-free")
          .map(({ metric, value }) => ({ metric, value }))
          .sort((a, b) => (a.metric ?? "").localeCompare(b.metric ?? "")),
        [
          { metric: "artificial_analysis_coding_index", value: 60 },
          { metric: "artificial_analysis_intelligence_index", value: 70 },
        ]
      );
      assert.equal(benchmarkSearchDb.hasEligibleModelBenchmarkSearch(), false);
      const searchRun = db
        .prepare(
          "SELECT attempts, last_run_at FROM model_benchmark_search_models WHERE model_id = ?"
        )
        .get(modelId);
      assert.equal(searchRun.attempts, 0);
      assert.equal(searchRun.last_run_at, null);
    } finally {
      releaseAaResponse(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      modelsDev.stopPeriodicSync();
    }
  });

  test("saved paused setting registers no sync timer and performs no fetch", async () => {
    delete process.env.MODELS_DEV_SYNC_ENABLED;
    await settingsDb.updateSettings({ modelsDevSyncEnabled: false, modelsDevSyncInterval: 60_000 });

    const intervalRegistrations: number[] = [];
    globalThis.setInterval = ((_callback, intervalMs) => {
      intervalRegistrations.push(intervalMs);
      return { unref() {} };
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = (() => {}) as typeof clearInterval;

    const requestUrls: string[] = [];
    globalThis.fetch = async (input) => {
      requestUrls.push(input instanceof Request ? input.url : String(input));
      throw new Error("Paused startup must not fetch");
    };
    const modelsDev = await importFresh("startup-saved-paused");

    await modelsDev.initModelsDevSync();

    assert.equal(modelsDev.getSyncStatus().enabled, false);
    assert.deepEqual(intervalRegistrations, []);
    assert.deepEqual(requestUrls, []);
  });

  test("direct full-catalog refresh publishes evidence without search or inference work", async () => {
    process.env.AA_API_KEY = "local-fetch-stub-only";
    const models = Array.from({ length: 4 }, (_, index) => ({
      id: `benchmark-hook-model-${index + 1}`,
      name: `Benchmark Hook Model ${index + 1}`,
      tool_call: true,
      reasoning: false,
      attachment: true,
      structured_output: true,
      temperature: true,
      release_date: "2026-01-01",
      last_updated: "2026-01-01",
      open_weights: false,
      cost: { input: 1, output: 2 },
      limit: { context: 8192, output: 1024 },
      modalities: { input: ["text"], output: ["text"] },
    }));
    const catalogData = {
      openai: {
        id: "openai",
        models: Object.fromEntries(models.map((model) => [model.id, model])),
      },
    };
    const requestUrls = [];
    let catalogSavedAtFirstBenchmarkFetch = false;
    let modelsDev;
    const jsonResponse = (data, headers = {}) =>
      new Response(JSON.stringify(data), { status: 200, headers });

    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      requestUrls.push(url);

      if (url === "https://models.dev/api.json") {
        return jsonResponse(catalogData);
      }
      if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
        if (
          requestUrls.filter((item) => item.startsWith("https://artificialanalysis.ai/")).length ===
          1
        ) {
          catalogSavedAtFirstBenchmarkFetch =
            modelsDev.getModelsDevPricing().openai[models[0].id]?.input === 1 &&
            modelsDev.getSyncedCapabilities().openai[models[0].id]?.tool_call === true;
        }
        const page = Number(new URL(url).searchParams.get("page") ?? "1");
        return jsonResponse(
          {
            intelligence_index_version: 4.1,
            pagination: { page, page_size: 200, total_pages: 4, has_more: page < 4 },
            data: [
              {
                slug: models[page - 1].id,
                name: `${models[page - 1].name} (high)`,
                release_date: "2026-10-26",
                evaluations: {
                  artificial_analysis_coding_index: 40 - page * 5,
                  artificial_analysis_intelligence_index: 45 - page * 5,
                },
              },
            ],
          },
          { date: "Mon, 26 Oct 2026 00:00:00 GMT" }
        );
      }
      if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
        return jsonResponse({
          leaderboards: [
            {
              name: "Verified",
              results: [
                {
                  model_id: models[0].id,
                  model_display: models[0].name,
                  resolved: 5,
                },
              ],
            },
          ],
        });
      }
      if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
        const request = JSON.parse(String(init?.body ?? "{}"));
        const model = request.name === "main" ? models[2] : models[1];
        return jsonResponse({
          rows: [{ metadata: { model_id: model.id }, metrics: { accuracy: 0.5 } }],
        });
      }
      if (url.includes("deepswe.datacurve.ai")) {
        return jsonResponse({ rows: [{ model: models[3].id, pass_rate: 0.25 }] });
      }
      throw new Error(`Unexpected local benchmark request: ${url}`);
    };

    modelsDev = await importFresh("full-catalog-refresh");
    const result = await modelsDev.syncModelsDev({ maxRetries: 0 });
    assert.equal(result.success, true);

    assert.ok(await waitFor(() => requestUrls.length > 1, 20_000));
    assert.equal(
      await waitFor(
        () =>
          core
            .getDbInstance()
            .prepare("SELECT COUNT(*) AS count FROM model_benchmark_search_models")
            .get().count === models.length,
        20_000
      ),
      true
    );
    const identityRows = core
      .getDbInstance()
      .prepare("SELECT model_id, status, attempts, last_run_at FROM model_benchmark_search_models")
      .all();
    assert.equal(catalogSavedAtFirstBenchmarkFetch, true);
    assert.deepEqual(
      identityRows.map((row) => row.model_id).sort(),
      models.map((model) => model.id).sort()
    );
    assert.ok(
      identityRows.every((row) =>
        ["scored", "review_required", "unrated_no_evidence"].includes(row.status)
      )
    );
    assert.ok(identityRows.every((row) => row.attempts === 0 && row.last_run_at === null));
    assert.equal(benchmarkSearchDb.hasEligibleModelBenchmarkSearch(), false);
    assert.ok(
      core
        .getDbInstance()
        .prepare(
          "SELECT COUNT(*) AS count FROM model_intelligence WHERE source LIKE 'benchmark_fitness:%'"
        )
        .get().count > 0
    );
    assert.equal(requestUrls.length, 9);
    assert.equal(requestUrls.filter((url) => url === "https://models.dev/api.json").length, 1);
    assert.equal(
      requestUrls.filter((url) => url.startsWith("https://artificialanalysis.ai/")).length,
      4
    );
    assert.equal(
      requestUrls.filter((url) => url.includes("raw.githubusercontent.com/SWE-bench/")).length,
      1
    );
    assert.equal(
      requestUrls.filter(
        (url) => url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read"
      ).length,
      2
    );
    assert.equal(requestUrls.filter((url) => url.includes("deepswe.datacurve.ai")).length, 1);
    assert.ok(
      requestUrls.every(
        (url) => !/huggingface|ollama\.com|search|chat\/|completion|inference|auto\//i.test(url)
      )
    );
  });
});
