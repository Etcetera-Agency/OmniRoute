import test from "node:test";
import assert from "node:assert/strict";

import { createChatPipelineHarness } from "../integration/_chatPipelineHarness.ts";

const harness = await createChatPipelineHarness("fork-benchmark-auto-fallback");
const {
  buildOpenAIResponse,
  buildRequest,
  handleChat,
  resetStorage,
  seedApiKey,
  seedConnection,
  settingsDb,
} = harness;
const core = await import("../../src/lib/db/core.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const modelsDevSync = await import("../../src/lib/modelsDevSync.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const lockouts = await import("../../open-sse/services/accountFallback.ts");
const searchDb = await import("../../src/lib/db/modelBenchmarkSearch.ts");
const processor = await import("../../src/lib/modelBenchmarkSearchProcessor.ts");
const search = await import("../../src/lib/modelBenchmarkSearch.ts");
const { getAllActiveSyncedModels } = await import("../../src/lib/db/models/activeSyncedCatalog.ts");
const provider = "openrouter";
const modelIds = ["tl012-unknown-alpha:free", "tl012-unknown-beta:free"];
const autoModel = "auto/general_high_so:free";
const previousAutoBands = process.env.OMNIROUTE_AUTO_BANDS;
const previousAaApiKey = process.env.AA_API_KEY;
const freeModelCapabilities = {
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
};

function seedFreeModels(connectionId: string, availableModels = modelIds): void {
  const db = core.getDbInstance();
  const upsert = db.prepare(
    "INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value"
  );
  upsert.run(
    "syncedAvailableModels",
    `${provider}:${connectionId}`,
    JSON.stringify(availableModels.map((id) => ({ id, isFree: true })))
  );
  upsert.run(
    "models_dev_zero_price",
    "snapshot",
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      modelsByProvider: { [provider]: modelIds },
    })
  );
  modelsDevSync.upsertSyncedCapabilities(
    provider,
    Object.fromEntries(availableModels.map((id) => [id, freeModelCapabilities]))
  );
}

async function configureFreeAuto(connectionModels: Array<{ id: string; models?: string[] }>) {
  const connectionIds = connectionModels.map(({ id }) => id);
  for (const { id, models } of connectionModels) seedFreeModels(id, models);
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  await settingsDb.updateSettings({
    freeAccessPolicy: "strict",
    modelsDevSyncEnabled: true,
    excludeTosAvoid: false,
    modelLockout: { enabled: true },
    resilienceSettings: { comboCooldownWait: { enabled: false } },
  });
  const apiKey = await seedApiKey({
    name: "tl012-internal-probe",
    allowedConnections: connectionIds,
    allowedModels: [autoModel, ...modelIds.flatMap((model) => [model, `${provider}/${model}`])],
  });
  return apiKey;
}

function autoRequest(authKey: string) {
  return buildRequest({
    authKey,
    body: {
      model: autoModel,
      stream: false,
      messages: [{ role: "user", content: "TL012 fallback acceptance" }],
    },
  });
}

test.beforeEach(async () => {
  lockouts.clearAllModelLockouts();
  await resetStorage();
});

test.afterEach(async () => {
  search.resetModelBenchmarkSearchStateForTests();
  lockouts.clearAllModelLockouts();
  await resetStorage();
  if (previousAutoBands === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = previousAutoBands;
  if (previousAaApiKey === undefined) delete process.env.AA_API_KEY;
  else process.env.AA_API_KEY = previousAaApiKey;
});

test.after(async () => harness.cleanup());

test("benchmark normalizer's free SO Auto falls through 504 and returns normalized evidence", async () => {
  const firstConnection = await seedConnection(provider, {
    name: "tl012-free-first",
    apiKey: "tl012-free-first",
    priority: 1,
  });
  const fallbackConnection = await seedConnection(provider, {
    name: "tl012-free-fallback",
    apiKey: "tl012-free-fallback",
    priority: 2,
  });
  const internalKey = await configureFreeAuto([
    { id: firstConnection.id, models: [modelIds[0]] },
    { id: fallbackConnection.id, models: [modelIds[1]] },
  ]);
  const model = { id: "openrouter/tl012-unknown-benchmark", name: "TL012 Unknown Benchmark" };
  await modelsDb.replaceSyncedAvailableModelsForConnection(provider, firstConnection.id, [
    { id: modelIds[0], name: modelIds[0], isFree: true },
    { id: model.id, name: model.name, isFree: false },
  ]);
  assert.ok(
    (await getAllActiveSyncedModels())[provider]?.some((entry) => entry.id === model.id),
    "unknown benchmark model must still be in the active synced catalog"
  );
  assert.equal(searchDb.listModelBenchmarkSearchEvidence(model.id).length, 0);
  assert.equal(await harness.apiKeysDb.pickApiKeyForInternalUse("internal-probe"), internalKey.key);

  const url = "https://example.org/tl012-benchmark-report";
  const quote = "TL012 Unknown Benchmark reached 52.3 pass rate on SWE-bench Verified";
  const searchResults = [{ url, title: quote, snippet: quote }];
  assert.equal(
    processor.buildNormalizationRequest(model.id, model.name, searchResults).model,
    autoModel
  );

  const attempts: Array<{ model: string; status: number }> = [];
  globalThis.fetch = async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    if (requestUrl.includes("/api/v1/key")) return Response.json({ data: { label: "test" } });
    if (requestUrl.includes("/api/v1/credits")) {
      return Response.json({ data: { total_credits: 1, total_usage: 0 } });
    }
    if (!requestUrl.includes("/api/v1/chat/completions")) {
      throw new Error(`Unexpected benchmark normalizer fetch: ${requestUrl}`);
    }

    const body = JSON.parse(String(init?.body));
    const targetModel = body.model as string;
    if (attempts.length === 0) {
      attempts.push({ model: targetModel, status: 504 });
      return Response.json({ error: { message: "gateway timeout" } }, { status: 504 });
    }
    attempts.push({ model: targetModel, status: 200 });
    const content = JSON.stringify({
      results: [
        {
          model_id: model.id,
          model_name: model.name,
          reasoning_effort: null,
          reasoning_config: null,
          benchmark: "SWE-bench Verified",
          benchmark_version: null,
          metric: "pass rate",
          value: 52.3,
          source_url: url,
          source_date: null,
          evidence_quote: quote,
        },
      ],
    });
    return Response.json({
      id: "chatcmpl-tl012-normalized",
      model: targetModel,
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    });
  };

  const result = await processor.processModelBenchmarkSearchResults(model, searchResults);
  assert.equal(result.status, "candidate_evidence_unrated", JSON.stringify(result));
  assert.equal(result.normalizerRequestCount, 1);
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(
    [result.evidence[0].matchedModelId, result.evidence[0].benchmark, result.evidence[0].value],
    [model.id, "SWE-bench Verified", 52.3]
  );
  assert.equal(attempts.length, 2);
  assert.deepEqual(
    attempts.map(({ status }) => status),
    [504, 200]
  );
  assert.ok(attempts.every(({ model: attemptedModel }) => modelIds.includes(attemptedModel)));
  assert.notEqual(attempts[0].model, attempts[1].model);

  const callLogs = await harness.callLogsDb.getCallLogs({ limit: 20 });
  const probeUsage = callLogs.filter((entry) => entry.apiKeyId === internalKey.id);
  assert.ok(probeUsage.length > 0, "internal-probe API key should own normalization usage");
  assert.ok(
    probeUsage.some((entry) => entry.tokens.out > 0),
    "successful fallback usage is attributed"
  );
});

test("benchmark normalizer completes 650s Auto fallback within native combo deadline", async () => {
  const firstConnection = await seedConnection(provider, {
    name: "tl012-long-first",
    apiKey: "tl012-long-first",
    priority: 1,
    providerSpecificData: { timeoutMs: 600_000 },
  });
  await configureFreeAuto([{ id: firstConnection.id, models: modelIds }]);
  await settingsDb.updateSettings({
    comboDefaults: { targetTimeoutMs: 400_000, comboTimeoutMs: 1_200_000 },
  });

  const settings = await settingsDb.getSettings();
  assert.equal(settings.comboDefaults.comboTimeoutMs, 1_200_000);
  const { resolveTargetTimeoutMsForTarget } = await import("../../open-sse/services/combo.ts");
  const { COMBO_LOOP_SAFETY_TIMEOUT_MS } =
    await import("../../open-sse/services/combo/comboPredicates.ts");
  const resolvedTargetTimeoutMs = await resolveTargetTimeoutMsForTarget(
    settings.comboDefaults,
    "lkgp",
    settings.resilienceSettings.comboCooldownWait,
    {
      kind: "model",
      stepId: "tl012-target-timeout",
      executionKey: "tl012-target-timeout",
      modelStr: `${provider}/${modelIds[0]}`,
      provider,
      providerId: null,
      connectionId: firstConnection.id,
      weight: 1,
      label: null,
    }
  );
  assert.equal(resolvedTargetTimeoutMs, 400_000);
  assert.equal(COMBO_LOOP_SAFETY_TIMEOUT_MS, 600_000);
  assert.equal(processor.NORMALIZATION_TIMEOUT_MS, 1_200_000);

  const model = { id: "openrouter/tl012-long-unknown", name: "TL012 Long Unknown" };
  const url = "https://example.org/tl012-long-benchmark";
  const quote = "TL012 Long Unknown reached 52.3 pass rate on SWE-bench Verified";
  const searchResults = [{ url, title: quote, snippet: quote }];
  const attempts: string[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  const scaledDelays = new Set([250_000, 400_000, 600_000, 1_200_000]);
  const scheduledDelays: number[] = [];
  let firstTargetTimeoutStartedAt: number | undefined;
  const setTimeoutWithScaling = (...args: Parameters<typeof setTimeout>) => {
    const delay = args[1];
    if (typeof delay === "number" && scaledDelays.has(delay)) {
      scheduledDelays.push(delay);
      if (delay === 400_000 && firstTargetTimeoutStartedAt === undefined) {
        firstTargetTimeoutStartedAt = performance.now();
      }
      args[1] = delay / 1_000;
    }
    return Reflect.apply(originalSetTimeout, globalThis, args);
  };
  globalThis.setTimeout = setTimeoutWithScaling as typeof setTimeout;
  let fallbackStartedAt: number | undefined;
  let firstAbortedAfterMs: number | undefined;
  let fallbackCompletedAfterMs: number | undefined;
  let firstSignal: AbortSignal | undefined;
  globalThis.fetch = async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    if (requestUrl.includes("/api/v1/key")) return Response.json({ data: { label: "test" } });
    if (requestUrl.includes("/api/v1/credits")) {
      return Response.json({ data: { total_credits: 1, total_usage: 0 } });
    }
    if (!requestUrl.includes("/api/v1/chat/completions")) {
      throw new Error(`Unexpected long normalizer fetch: ${requestUrl}`);
    }

    const targetModel = JSON.parse(String(init?.body)).model as string;
    attempts.push(targetModel);
    if (attempts.length === 2) fallbackStartedAt = performance.now();
    const signal = init?.signal as AbortSignal | undefined;
    if (attempts.length === 1) {
      firstSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            firstAbortedAfterMs =
              firstTargetTimeoutStartedAt === undefined
                ? undefined
                : (performance.now() - firstTargetTimeoutStartedAt) * 1_000;
            reject(signal.reason);
          },
          { once: true }
        );
      });
    }

    const content = JSON.stringify({
      results: [
        {
          model_id: model.id,
          model_name: model.name,
          reasoning_effort: null,
          reasoning_config: null,
          benchmark: "SWE-bench Verified",
          benchmark_version: null,
          metric: "pass rate",
          value: 52.3,
          source_url: url,
          source_date: null,
          evidence_quote: quote,
        },
      ],
    });
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        fallbackCompletedAfterMs = (performance.now() - fallbackStartedAt!) * 1_000;
        resolve(
          Response.json({
            id: "chatcmpl-tl012-long-normalized",
            model: targetModel,
            choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          })
        );
      }, 250_000);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true }
      );
    });
  };

  const waitForAttempts = async (count: number) => {
    const deadline = performance.now() + 5_000;
    while (attempts.length < count && performance.now() < deadline) {
      await new Promise<void>((resolve) => originalSetTimeout(resolve, 5));
    }
    assert.equal(attempts.length, count, "expected mocked provider attempt did not start");
  };

  try {
    const resultPromise = processor.processModelBenchmarkSearchResults(model, searchResults);
    await waitForAttempts(1);
    await waitForAttempts(2);
    assert.equal(firstSignal?.aborted, true);
    assert.ok(firstAbortedAfterMs !== undefined);
    assert.ok(
      firstAbortedAfterMs >= 350_000 && firstAbortedAfterMs < 500_000,
      `first target aborted after ${firstAbortedAfterMs} virtual ms`
    );

    const result = await resultPromise;
    assert.ok(fallbackStartedAt !== undefined);
    assert.ok(fallbackCompletedAfterMs !== undefined);
    assert.ok(fallbackCompletedAfterMs >= 200_000 && fallbackCompletedAfterMs < 350_000);
    const virtualElapsedMs = resolvedTargetTimeoutMs! + 250_000;
    const observedVirtualElapsedMs =
      (fallbackStartedAt - firstTargetTimeoutStartedAt!) * 1_000 + fallbackCompletedAfterMs;
    assert.equal(virtualElapsedMs, 650_000);
    assert.ok(virtualElapsedMs > COMBO_LOOP_SAFETY_TIMEOUT_MS);
    assert.ok(virtualElapsedMs < processor.NORMALIZATION_TIMEOUT_MS);
    assert.ok(observedVirtualElapsedMs > COMBO_LOOP_SAFETY_TIMEOUT_MS);
    assert.ok(observedVirtualElapsedMs < processor.NORMALIZATION_TIMEOUT_MS);
    assert.ok(scheduledDelays.includes(400_000));
    assert.ok(scheduledDelays.includes(250_000));
    assert.ok(scheduledDelays.includes(1_200_000));
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every((attempt) => modelIds.includes(attempt)));
    assert.notEqual(attempts[0], attempts[1]);
    assert.equal(result.status, "candidate_evidence_unrated", JSON.stringify(result));
    assert.deepEqual(
      [result.evidence[0].matchedModelId, result.evidence[0].benchmark, result.evidence[0].value],
      [model.id, "SWE-bench Verified", 52.3]
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("benchmark queue settles its claimed run after free SO Auto pool exhaustion", async () => {
  process.env.AA_API_KEY = "tl012-source-fixture";
  const firstConnection = await seedConnection(provider, {
    name: "tl012-queue-first",
    apiKey: "tl012-queue-first",
    priority: 1,
  });
  const fallbackConnection = await seedConnection(provider, {
    name: "tl012-queue-fallback",
    apiKey: "tl012-queue-fallback",
    priority: 2,
  });
  await configureFreeAuto([
    { id: firstConnection.id, models: [modelIds[0]] },
    { id: fallbackConnection.id, models: [modelIds[1]] },
  ]);
  const model = { id: "openrouter/tl012-queue-unknown", name: "TL012 Queue Unknown" };
  await modelsDb.replaceSyncedAvailableModelsForConnection(provider, firstConnection.id, [
    { id: modelIds[0], name: modelIds[0], isFree: true },
    { id: model.id, name: model.name, isFree: false },
  ]);
  await providersDb.createProviderConnection({
    provider: "ollama-cloud",
    authType: "apikey",
    name: "tl012-search-fixture",
    apiKey: "tl012-search-fixture",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  assert.ok(
    (await getAllActiveSyncedModels())[provider]?.some((entry) => entry.id === model.id),
    "queue target must pass the active catalog gate"
  );
  searchDb.enqueueModelBenchmarkSearches([model]);

  const attempts: Array<{ model: string; status: number }> = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://artificialanalysis.ai/api/v2/language/models/free")) {
      return Response.json({
        intelligence_index_version: 4.1,
        pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
        data: [],
      });
    }
    if (url.includes("raw.githubusercontent.com/SWE-bench/")) {
      return Response.json({ leaderboards: [] });
    }
    if (url === "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read") {
      return Response.json({ leaderboard: { name: "fixture" }, rows: [] });
    }
    if (url === "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json") {
      return Response.json({ rows: [] });
    }
    if (url.startsWith("https://huggingface.co/api/models?")) return Response.json([]);
    if (url === "https://ollama.com/api/web_search") {
      return Response.json({
        results: [
          {
            title: "TL012 Queue Unknown benchmark evaluation",
            url: "https://example.org/tl012-queue-benchmark",
            content: "Fixture search result",
          },
        ],
      });
    }
    if (url.includes("/api/v1/key")) return Response.json({ data: { label: "test" } });
    if (url.includes("/api/v1/credits")) {
      return Response.json({ data: { total_credits: 1, total_usage: 0 } });
    }
    if (url.includes("/api/v1/chat/completions")) {
      const targetModel = JSON.parse(String(init?.body)).model as string;
      const status = attempts.length === 0 ? 504 : 503;
      attempts.push({ model: targetModel, status });
      return Response.json({ error: { message: `${targetModel} failed` } }, { status });
    }
    throw new Error(`Unexpected queue fixture fetch: ${url}`);
  };

  await search.drainModelBenchmarkSearchQueue();

  const [run] = searchDb.listModelBenchmarkSearchRuns();
  assert.equal(run.status, "review_required");
  assert.notEqual(run.status, "pending");
  assert.notEqual(run.status, "running");
  assert.equal(run.attempts, 1);
  assert.equal(run.normalizationStatus, "normalization_request_failed_unrated");
  assert.equal(run.sourceStatus.normalizationProcessor.normalizerRequestCount, 1);
  assert.ok(
    ["HTTP 503", "HTTP 504"].includes(run.sourceStatus.normalizationProcessor.error),
    JSON.stringify(run.sourceStatus.normalizationProcessor)
  );
  assert.deepEqual(
    attempts.map(({ status }) => status),
    [504, 503]
  );
  assert.deepEqual(
    [...new Set(attempts.map(({ model: attemptedModel }) => attemptedModel))].sort(),
    [...modelIds].sort()
  );
});

test("next free SO Auto selection excludes the cooled model from its account", async () => {
  const connection = await seedConnection(provider, { apiKey: "tl012-free-cooled" });
  const authKey = (await configureFreeAuto([{ id: connection.id }])).key;
  let firstModel = "";
  let firstRequestAttempts = 0;
  globalThis.fetch = async (_url, init) => {
    const model = JSON.parse(String(init?.body)).model;
    firstRequestAttempts += 1;
    if (firstRequestAttempts === 1) {
      firstModel = model;
      return new Response("upstream timeout", { status: 504 });
    }
    return buildOpenAIResponse("first request fallback", model);
  };
  const failed = await handleChat(autoRequest(authKey));
  assert.equal(failed.status, 200);
  assert.ok(modelIds.includes(firstModel));
  assert.ok(lockouts.getModelLockoutInfo(provider, connection.id, firstModel));

  const nextAttempts: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const model = JSON.parse(String(init?.body)).model;
    nextAttempts.push(model);
    return buildOpenAIResponse("next free candidate", model);
  };
  const next = await handleChat(autoRequest(authKey));
  assert.equal(next.status, 200);
  assert.ok(nextAttempts.length > 0);
  assert.ok(nextAttempts.every((model) => model !== firstModel && modelIds.includes(model)));
});
