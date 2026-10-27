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
const benchmarkSearchDb = await import("../../src/lib/db/modelBenchmarkSearch.ts");
await import("../../src/lib/modelBenchmarkSearch.ts");
const modulePath = path.join(process.cwd(), "src/lib/modelsDevSync.ts");
const originalFetch = globalThis.fetch;
const originalAaApiKey = process.env.AA_API_KEY;

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
    if (originalAaApiKey === undefined) delete process.env.AA_API_KEY;
    else process.env.AA_API_KEY = originalAaApiKey;
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
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(" "));
    try {
      const result = await modelsDev.syncModelsDev({ maxRetries: 0 });
      assert.equal(result.success, true);
      assert.ok(result.modelCount > 0);
      assert.ok(result.capabilityCount > 0);
      assert.equal(
        await waitFor(() =>
          warnings.some((warning) => warning.includes("[MODEL_BENCHMARK_SEARCH]"))
        ),
        true
      );
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
      assert.ok(
        warnings.some(
          (warning) =>
            warning.includes("[MODEL_BENCHMARK_SEARCH] Background refresh failed") &&
            warning.includes("AA Free API key is not configured")
        )
      );
      const queueCount = core
        .getDbInstance()
        .prepare("SELECT COUNT(*) AS count FROM model_benchmark_search_models")
        .get().count;
      assert.equal(queueCount, 0);
    } finally {
      console.warn = originalWarn;
    }
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

  test("syncModelsDev passes saved full-catalog identities to the direct refresh", async () => {
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
    assert.equal(benchmarkSearchDb.claimModelBenchmarkSearch(), null);
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
      requestUrls.every((url) => !/huggingface|ollama\.com|chat\/completions|inference/i.test(url))
    );
  });
});
