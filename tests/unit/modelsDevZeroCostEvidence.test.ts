import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractModelsDevZeroPriceModels,
  type ModelsDevData,
} from "../../src/lib/modelsDevSync/transform.ts";
import { createProviderNodeSchema } from "../../src/shared/validation/schemas/provider.ts";
import {
  APINEX_PUBLIC_MODELS_URL,
  bindApinexZeroPriceModels,
  composeFreshZeroPriceEvidence,
  extractApinexZeroPriceModelIds,
  type ApinexZeroPriceEvidence,
} from "../../src/lib/modelsDevSync/apinex.ts";
import { filterStrictZeroCostCandidates } from "../../open-sse/services/autoCombo/strictZeroCostFilter.ts";
import { OPENAI_COMPATIBLE_PREFIX } from "../../src/shared/constants/providers.ts";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-zero-price-"));
process.env.DATA_DIR = DATA_DIR;

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const modulePath = path.join(process.cwd(), "src/lib/modelsDevSync.ts");
const loadedModules = new Set<{ stopPeriodicSync?: () => void }>();

async function importFresh(label: string) {
  const mod = await import(
    `${pathToFileURL(modulePath).href}?zero-price-${label}-${Date.now()}-${Math.random()}`
  );
  loadedModules.add(mod);
  return mod;
}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  process.env.DATA_DIR = DATA_DIR;
}

test.afterEach(() => {
  for (const mod of loadedModules) mod.stopPeriodicSync?.();
  loadedModules.clear();
  globalThis.fetch = originalFetch;
  restoreEnv();
});

test.after(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("extracts only explicit zero/zero prices with exact raw provider and model IDs", () => {
  const raw = {
    openrouter: {
      id: "openrouter",
      models: {
        "vendor/model:free": {
          id: "different-embedded-id",
          name: "Free",
          cost: { input: 0, output: 0 },
        },
        free: { id: "free", name: "Dynamic route", cost: { input: 0, output: 0 } },
        "missing-output": { id: "missing-output", name: "Partial", cost: { input: 0 } },
        "missing-input": { id: "missing-input", name: "Partial", cost: { output: 0 } },
        "nonzero-input": { id: "nonzero-input", name: "Paid", cost: { input: 0.01, output: 0 } },
        "nonzero-output": { id: "nonzero-output", name: "Paid", cost: { input: 0, output: 0.01 } },
        "nonzero-audio": {
          id: "nonzero-audio",
          name: "Audio priced",
          cost: { input: 0, output: 0, input_audio: 0.01 },
        },
        "string-input": {
          id: "string-input",
          name: "String zero",
          cost: { input: "0", output: 0 },
        },
      },
    },
    togetherai: {
      id: "togetherai",
      models: {
        "direct-free": { id: "direct-free", name: "Direct", cost: { input: 0, output: 0 } },
      },
    },
  } as unknown as ModelsDevData;

  assert.deepEqual(extractModelsDevZeroPriceModels(raw), {
    openrouter: ["vendor/model:free"],
    togetherai: ["direct-free"],
  });
});

const APINEX_NOW = Date.parse("2026-10-29T12:00:00.000Z");
const APINEX_NODE = "openai-compatible-chat-fbf9bf6f-8827-4330-a87d-9b5eaf4d30b1";
const APINEX_CONNECTION = "9565fb26-817c-42b4-baa0-b76733a951c4";
const OPENAI_API_TYPES = [
  "chat",
  "responses",
  "embeddings",
  "audio-transcriptions",
  "audio-speech",
  "images-generations",
] as const;
const APINEX_OTHER_API_FORMATS = OPENAI_API_TYPES.filter((apiType) => apiType !== "chat").map(
  (apiType) => ({
    apiType,
    id: `${OPENAI_COMPATIBLE_PREFIX}${apiType}-tl324-test`,
    connectionId: `tl324-${apiType}-connection`,
  })
);
// Official APInex public catalog IDs and prices captured 2026-10-29; sync tests mock the fetch.
const APINEX_PUBLIC_CATALOG = [
  { id: "free/gemini-3.8-flash", input: 0, output: 0 },
  { id: "free/qwen-3.8-max", input: 0, output: 0 },
  { id: "free/kimi-k3", input: 0, output: 0 },
  { id: "free/deepseek-v4.1-flash", input: 0, output: 0 },
  { id: "free/glm-5.3-flash", input: 0, output: 0 },
  { id: "free/muse-spark-1.3", input: 0, output: 0 },
  { id: "gemini-4-argon", input: 0.6, output: 0.6 },
  { id: "claude-sonnet-5.5", input: 0.4, output: 0.4 },
  { id: "claude-opus-5.5", input: 0.5, output: 0.5 },
  { id: "claude-fable-5.1", input: 2, output: 2 },
  { id: "gpt-6.1-terra", input: 0.17, output: 0.17 },
  { id: "gpt-6.1-sol", input: 0.3, output: 0.3 },
  { id: "gpt-6-astra", input: 0.5, output: 0.5 },
  { id: "deepseek-v4.1-flash", input: 0.06, output: 0.06 },
  { id: "grok-4.7", input: 0.3, output: 0.3 },
  { id: "gemini-3.8-flash", input: 0.1, output: 0.1 },
  { id: "deepseek-v4-flash", input: 0.05, output: 0.05 },
  { id: "deepseek-v4-pro", input: 0.07, output: 0.07 },
  { id: "gemini-3.1-pro", input: 0.15, output: 0.15 },
  { id: "gpt-6-luna", input: 0.075, output: 0.075 },
  { id: "free/minimax-m3.1-flash", input: 0, output: 0 },
  { id: "free/glm-5.3", input: 0, output: 0 },
  { id: "free/deepseek-v4-pro-0813", input: 0, output: 0 },
  { id: "free/gpt-6-luna", input: 0, output: 0 },
  { id: "free/glm-5.3-flashx", input: 0, output: 0 },
  { id: "free/jev-1.13", input: 0, output: 0 },
  { id: "free/mimo-v2.6-pro", input: 0, output: 0 },
  { id: "free/minimax-m3", input: 0, output: 0 },
  { id: "free/deepseek-v4-flash-0731", input: 0, output: 0 },
  { id: "free/mimo-v2.6-flash", input: 0, output: 0 },
  { id: "free/claude-sonnet-4.6", input: 0, output: 0 },
  { id: "free/hy4", input: 0, output: 0 },
  { id: "free/claude-opus-4.6", input: 0, output: 0 },
  { id: "free/gemini-3.1-pro", input: 0, output: 0 },
  { id: "free/kimi-k2.8", input: 0, output: 0 },
  { id: "glm-5.3-flash", input: 0.05, output: 0.05 },
  { id: "glm-5.3", input: 0.15, output: 0.15 },
  { id: "kimi-k3.1-pro", input: 0.3, output: 0.4 },
  { id: "drex-v2.0", input: 0.04, output: 0 },
  { id: "jev-1.13", input: 0.042, output: 0 },
  { id: "subq-snap-preview", input: 0.05, output: 0 },
  { id: "gpt-6-luna-decisions", input: 0.1, output: 0 },
  { id: "muse-spark-1.3", input: 0.3, output: 0.3 },
  { id: "hy4-preview", input: 0.3, output: 0.3 },
];

function apinexRecord(id: string, input = 0, output = 0, extra: Record<string, unknown> = {}) {
  return {
    id,
    provider: "Display label ignored",
    name: "Free name ignored",
    dollarsPer1M: input,
    outputDollarsPer1M: output,
    ...extra,
  };
}

test("provider-node schema stores the compatible type separately from each API format", () => {
  for (const apiType of OPENAI_API_TYPES) {
    const parsed = createProviderNodeSchema.safeParse({
      name: "APInex",
      prefix: "apinex",
      apiType,
      type: "openai-compatible",
      baseUrl: "https://api.apinex.bond/v1",
    });

    assert.equal(parsed.success, true, apiType);
    assert.equal(parsed.data.type, "openai-compatible");
    assert.equal(parsed.data.apiType, apiType);
  }

  assert.equal(APINEX_NODE.startsWith(`${OPENAI_COMPATIBLE_PREFIX}chat-`), true);
  assert.equal(
    createProviderNodeSchema.safeParse({
      name: "APInex",
      prefix: "apinex",
      apiType: "chat",
      type: "openai-compatible-chat",
      baseUrl: "https://api.apinex.bond/v1",
    }).success,
    false
  );
});

test("parses official APInex prices by exact numeric price fields only", () => {
  const payload = {
    models: [
      apinexRecord("free/exact-zero", 0, 0, { allowFree: false }),
      apinexRecord("free/mixed", 0, 0.02),
      apinexRecord("named-free-paid", 0.01, 0, { name: "Free", provider: "Free", allowFree: true }),
      apinexRecord("free/paid-cache", 0, 0, { cachedDollarsPer1M: 0.001 }),
    ],
  };

  assert.deepEqual(extractApinexZeroPriceModelIds(payload), ["free/exact-zero"]);
  assert.equal(APINEX_PUBLIC_MODELS_URL, "https://apinex.bond/api/public/models");
});

test("rejects incomplete or ambiguous APInex catalog responses", () => {
  for (const payload of [
    null,
    {},
    { models: [] },
    { models: [null] },
    { models: [apinexRecord("")] },
    { models: [apinexRecord("duplicate"), apinexRecord("duplicate")] },
    { models: [{ id: "missing-input", outputDollarsPer1M: 0 }] },
    { models: [apinexRecord("string-price", "0" as unknown as number, 0)] },
    { models: [apinexRecord("negative-price", -1, 0)] },
    { models: [apinexRecord("malformed-extra-price", 0, 0, { cachedDollarsPer1M: "0" })] },
  ]) {
    assert.throws(() => extractApinexZeroPriceModelIds(payload));
  }
});

test("binds exact raw IDs only for openai-compatible nodes at the exact APInex endpoint", () => {
  const bound = bindApinexZeroPriceModels(
    ["free/exact", "free/responses-exact", "free/unavailable"],
    [
      {
        id: APINEX_NODE,
        type: "openai-compatible",
        baseUrl: "https://api.apinex.bond/v1",
        availableModelIds: ["free/exact", "free/other"],
      },
      {
        id: `${OPENAI_COMPATIBLE_PREFIX}responses-tl324-test`,
        type: "openai-compatible",
        baseUrl: "https://api.apinex.bond/v1",
        availableModelIds: ["free/responses-exact", "free/responses-other"],
      },
      {
        id: "openai-compatible-wrong-endpoint",
        type: "openai-compatible",
        baseUrl: "https://other.example/v1",
        availableModelIds: ["free/exact"],
      },
      {
        id: "anthropic-compatible-apinex-host",
        type: "anthropic-compatible",
        baseUrl: "https://api.apinex.bond/v1",
        availableModelIds: ["free/exact"],
      },
      {
        id: "openai-compatible-responses-apinex-host",
        type: "openai-compatible-responses",
        baseUrl: "https://api.apinex.bond/v1",
        availableModelIds: ["free/exact"],
      },
    ]
  );

  assert.deepEqual(bound, {
    [APINEX_NODE]: ["free/exact"],
    [`${OPENAI_COMPATIBLE_PREFIX}responses-tl324-test`]: ["free/responses-exact"],
  });
});

test("composes both fresh sources in either order with oldest timestamp", () => {
  const modelsDev = {
    fetchedAt: new Date(APINEX_NOW - 2 * 60 * 60 * 1000).toISOString(),
    modelsByProvider: { openrouter: ["router/free"] },
  };
  const apinex: ApinexZeroPriceEvidence = {
    sourceUrl: APINEX_PUBLIC_MODELS_URL,
    fetchedAt: new Date(APINEX_NOW - 60 * 60 * 1000).toISOString(),
    modelsByProvider: { [APINEX_NODE]: ["free/apinex"] },
  };
  const current = { [APINEX_NODE]: new Set(["free/apinex"]) };

  const modelsDevFirst = composeFreshZeroPriceEvidence(modelsDev, apinex, current, APINEX_NOW);
  assert.deepEqual(modelsDevFirst, {
    fetchedAt: modelsDev.fetchedAt,
    modelsByProvider: {
      openrouter: ["router/free"],
      [APINEX_NODE]: ["free/apinex"],
    },
  });

  const apinexFirst = composeFreshZeroPriceEvidence(
    { ...modelsDev, fetchedAt: new Date(APINEX_NOW - 60 * 60 * 1000).toISOString() },
    { ...apinex, fetchedAt: new Date(APINEX_NOW - 2 * 60 * 60 * 1000).toISOString() },
    current,
    APINEX_NOW
  );
  assert.equal(apinexFirst.fetchedAt, new Date(APINEX_NOW - 2 * 60 * 60 * 1000).toISOString());
});

test("drops stale and future source independently and preserves exact 36-hour boundary", () => {
  const modelsDevFresh = {
    fetchedAt: new Date(APINEX_NOW - 1).toISOString(),
    modelsByProvider: { openrouter: ["router/free"] },
  };
  const staleApinex: ApinexZeroPriceEvidence = {
    sourceUrl: APINEX_PUBLIC_MODELS_URL,
    fetchedAt: new Date(APINEX_NOW - 36 * 60 * 60 * 1000 - 1).toISOString(),
    modelsByProvider: { [APINEX_NODE]: ["free/stale"] },
  };
  const current = { [APINEX_NODE]: new Set(["free/stale", "free/exact-boundary", "free/future"]) };

  assert.deepEqual(
    composeFreshZeroPriceEvidence(modelsDevFresh, staleApinex, current, APINEX_NOW),
    modelsDevFresh
  );

  const exactBoundary = composeFreshZeroPriceEvidence(
    null,
    {
      ...staleApinex,
      fetchedAt: new Date(APINEX_NOW - 36 * 60 * 60 * 1000).toISOString(),
      modelsByProvider: { [APINEX_NODE]: ["free/exact-boundary"] },
    },
    current,
    APINEX_NOW
  );
  assert.deepEqual(exactBoundary.modelsByProvider, { [APINEX_NODE]: ["free/exact-boundary"] });

  const future = composeFreshZeroPriceEvidence(
    null,
    {
      ...staleApinex,
      fetchedAt: new Date(APINEX_NOW + 1).toISOString(),
      modelsByProvider: { [APINEX_NODE]: ["free/future"] },
    },
    current,
    APINEX_NOW
  );
  assert.equal(future, null);
});

function sanitizedApinexRuntimeModels(): Array<{
  id: string;
  name: string;
  source: "imported";
}> {
  return APINEX_PUBLIC_CATALOG.map(({ id }) => ({
    id,
    name: id,
    source: "imported",
  }));
}

async function createApinexTestNode(
  id: string,
  baseUrl: string,
  models: Array<{ id: string; visibility?: "hide" | "list" }>,
  apiType = "chat",
  connectionId = id === APINEX_NODE ? APINEX_CONNECTION : "tl324-connection"
) {
  const { createProviderNode } = await import("../../src/lib/db/providers/nodes.ts");
  const { getDbInstance } = await import("../../src/lib/db/core.ts");
  await createProviderNode({
    id,
    type: "openai-compatible",
    apiType,
    name: "Display name is not identity",
    prefix: "apinex",
    baseUrl,
  });
  getDbInstance()
    .prepare("INSERT INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, ?)")
    .run(`${id}:${connectionId}`, JSON.stringify(models));
  return getDbInstance();
}

const modelsDevPayload = {
  openrouter: {
    id: "openrouter",
    models: {
      "router/free": {
        id: "router/free",
        name: "Router free",
        cost: { input: 0, output: 0 },
      },
    },
  },
};

test("syncs exact APInex zero IDs for every configured OpenAI API format", async () => {
  delete process.env.MODELS_DEV_SYNC_ENABLED;
  const syncedModels = sanitizedApinexRuntimeModels();
  const hiddenModelId = "free/deepseek-v4.1-flash";
  const chatSyncedModels = syncedModels.filter(({ id }) => id === hiddenModelId);
  const { getHiddenModelsByProvider, setModelIsHidden } =
    await import("../../src/lib/db/models.ts");
  const db = await createApinexTestNode(APINEX_NODE, "https://api.apinex.bond/v1", syncedModels);
  for (const { id, apiType, connectionId } of APINEX_OTHER_API_FORMATS) {
    await createApinexTestNode(
      id,
      "https://api.apinex.bond/v1",
      chatSyncedModels,
      apiType,
      connectionId
    );
  }
  assert.deepEqual(
    db
      .prepare("SELECT id, type, prefix, api_type, base_url FROM provider_nodes WHERE id = ?")
      .get(APINEX_NODE),
    {
      id: APINEX_NODE,
      type: "openai-compatible",
      prefix: "apinex",
      api_type: "chat",
      base_url: "https://api.apinex.bond/v1",
    }
  );
  for (const { id, apiType } of APINEX_OTHER_API_FORMATS) {
    assert.deepEqual(
      db
        .prepare("SELECT id, type, prefix, api_type, base_url FROM provider_nodes WHERE id = ?")
        .get(id),
      {
        id,
        type: "openai-compatible",
        prefix: "apinex",
        api_type: apiType,
        base_url: "https://api.apinex.bond/v1",
      }
    );
  }
  setModelIsHidden(APINEX_NODE, hiddenModelId, true);
  const hiddenModelsBeforeSync = getHiddenModelsByProvider();
  assert.equal(hiddenModelsBeforeSync.get(APINEX_NODE)?.has(hiddenModelId), true);
  db.prepare(
    "DELETE FROM key_value WHERE namespace IN ('models_dev_pricing', 'models_dev_zero_price', 'apinex_zero_price')"
  ).run();
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === "https://models.dev/api.json") {
      return new Response(JSON.stringify(modelsDevPayload), { status: 200 });
    }
    if (url === APINEX_PUBLIC_MODELS_URL) {
      return new Response(
        JSON.stringify({
          models: APINEX_PUBLIC_CATALOG.map(({ id, input, output }) =>
            apinexRecord(id, input, output)
          ),
          healthCheckedAt: "ignored for pricing provenance",
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const modelsDev = await importFresh("apinex-bound-sync");
  const result = await modelsDev.syncModelsDev({ syncCapabilities: false, maxRetries: 0 });
  assert.equal(result.success, true);
  assert.deepEqual(urls, ["https://models.dev/api.json", APINEX_PUBLIC_MODELS_URL]);

  const sourceRow = db
    .prepare(
      "SELECT value FROM key_value WHERE namespace = 'apinex_zero_price' AND key = 'snapshot'"
    )
    .get() as { value: string };
  const source = JSON.parse(sourceRow.value) as ApinexZeroPriceEvidence;
  assert.equal(source.sourceUrl, APINEX_PUBLIC_MODELS_URL);
  assert.equal(syncedModels.length, 44);
  const expectedZeroPriceIds = APINEX_PUBLIC_CATALOG.filter(
    ({ input, output }) => input === 0 && output === 0
  ).map(({ id }) => id);
  assert.equal(expectedZeroPriceIds.length, 21);
  assert.equal(syncedModels.length - expectedZeroPriceIds.length, 23);
  assert.deepEqual(source.modelsByProvider[APINEX_NODE], expectedZeroPriceIds);
  for (const { id } of APINEX_OTHER_API_FORMATS) {
    assert.deepEqual(source.modelsByProvider[id], [hiddenModelId]);
  }
  assert.equal(source.modelsByProvider.apinex, undefined);

  const pricingRow = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'models_dev_pricing' AND key = ?")
    .get(APINEX_NODE) as { value: string };
  const pricing = JSON.parse(pricingRow.value) as Record<string, { input: number; output: number }>;
  const expectedPricing = Object.fromEntries(
    expectedZeroPriceIds.map((id) => [id, { input: 0, output: 0 }])
  );
  assert.deepEqual(pricing, expectedPricing);
  for (const { id } of APINEX_OTHER_API_FORMATS) {
    const pricingRow = db
      .prepare("SELECT value FROM key_value WHERE namespace = 'models_dev_pricing' AND key = ?")
      .get(id) as { value: string };
    assert.deepEqual(JSON.parse(pricingRow.value), { [hiddenModelId]: { input: 0, output: 0 } });
  }
  const evidence = modelsDev.getModelsDevZeroPriceEvidence();
  assert.deepEqual(evidence.modelsByProvider[APINEX_NODE], expectedZeroPriceIds);
  for (const { id } of APINEX_OTHER_API_FORMATS) {
    assert.deepEqual(evidence.modelsByProvider[id], [hiddenModelId]);
  }
  assert.equal(evidence.modelsByProvider.apinex, undefined);

  const exactCandidate = {
    provider: APINEX_NODE,
    model: hiddenModelId,
    connectionId: APINEX_CONNECTION,
  };
  const formatCandidates = APINEX_OTHER_API_FORMATS.map(({ id, connectionId }) => ({
    provider: id,
    model: hiddenModelId,
    connectionId,
  }));
  const prefixCandidate = { ...exactCandidate, provider: "apinex" };
  assert.deepEqual(
    filterStrictZeroCostCandidates([exactCandidate, ...formatCandidates, prefixCandidate], {
      enabled: true,
      catalog: [],
      resolveFreeAccessState: () => undefined,
      minRemainingAllowance: 0,
      maxStateAgeMs: 60_000,
      modelsDevZeroPriceEvidence: evidence,
    }),
    [exactCandidate, ...formatCandidates]
  );

  db.prepare("DELETE FROM key_value WHERE namespace = 'models_dev_zero_price'").run();
  assert.deepEqual(modelsDev.getModelsDevZeroPriceEvidence(), {
    fetchedAt: source.fetchedAt,
    modelsByProvider: {
      [APINEX_NODE]: expectedZeroPriceIds,
      ...Object.fromEntries(APINEX_OTHER_API_FORMATS.map(({ id }) => [id, [hiddenModelId]])),
    },
  });

  const storedModels = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'syncedAvailableModels' AND key = ?")
    .get(`${APINEX_NODE}:${APINEX_CONNECTION}`) as { value: string };
  assert.deepEqual(JSON.parse(storedModels.value), syncedModels);
  for (const { id, connectionId } of APINEX_OTHER_API_FORMATS) {
    const storedModels = db
      .prepare("SELECT value FROM key_value WHERE namespace = 'syncedAvailableModels' AND key = ?")
      .get(`${id}:${connectionId}`) as { value: string };
    assert.deepEqual(JSON.parse(storedModels.value), chatSyncedModels);
  }
  assert.deepEqual(getHiddenModelsByProvider(), hiddenModelsBeforeSync);

  db.prepare("UPDATE provider_nodes SET base_url = 'https://other.example/v1' WHERE id = ?").run(
    APINEX_NODE
  );
  assert.deepEqual(
    modelsDev.getModelsDevZeroPriceEvidence().modelsByProvider,
    Object.fromEntries(APINEX_OTHER_API_FORMATS.map(({ id }) => [id, [hiddenModelId]]))
  );
});

test("models.dev save survives APInex failure without refreshing source time", async () => {
  delete process.env.MODELS_DEV_SYNC_ENABLED;
  const providerId = "openai-compatible-chat-apinex-persist-test";
  const db = await createApinexTestNode(providerId, "https://api.apinex.bond/v1", [
    { id: "free/persisted" },
  ]);
  db.prepare(
    "DELETE FROM key_value WHERE namespace IN ('models_dev_pricing', 'models_dev_zero_price', 'apinex_zero_price')"
  ).run();
  const originalSource: ApinexZeroPriceEvidence = {
    sourceUrl: APINEX_PUBLIC_MODELS_URL,
    fetchedAt: new Date(Date.now() - 35 * 60 * 60 * 1000).toISOString(),
    modelsByProvider: { [providerId]: ["free/persisted"] },
  };
  db.prepare(
    "INSERT INTO key_value (namespace, key, value) VALUES ('apinex_zero_price', 'snapshot', ?)"
  ).run(JSON.stringify(originalSource));

  let urlCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    urlCalls++;
    if (url === "https://models.dev/api.json") {
      return new Response(JSON.stringify(modelsDevPayload), { status: 200 });
    }
    if (url === APINEX_PUBLIC_MODELS_URL) throw new Error("APInex unavailable");
    throw new Error(`Unexpected URL ${url}`);
  };

  const modelsDev = await importFresh("apinex-save-failure");
  const result = await modelsDev.syncModelsDev({ syncCapabilities: false, maxRetries: 0 });
  assert.equal(result.success, true);
  const sourceRow = db
    .prepare(
      "SELECT value FROM key_value WHERE namespace = 'apinex_zero_price' AND key = 'snapshot'"
    )
    .get() as { value: string };
  assert.deepEqual(JSON.parse(sourceRow.value), originalSource);

  const pricingRow = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'models_dev_pricing' AND key = ?")
    .get(providerId) as { value: string };
  assert.deepEqual(JSON.parse(pricingRow.value), { "free/persisted": { input: 0, output: 0 } });
  assert.equal(modelsDev.getModelsDevZeroPriceEvidence().fetchedAt, originalSource.fetchedAt);

  globalThis.fetch = async (input) => {
    const url = String(input);
    urlCalls++;
    if (url === APINEX_PUBLIC_MODELS_URL) {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const invalidSourceResult = await modelsDev.syncModelsDev({
    syncCapabilities: false,
    maxRetries: 0,
  });
  assert.equal(invalidSourceResult.success, true);
  const sourceAfterInvalidResponse = db
    .prepare(
      "SELECT value FROM key_value WHERE namespace = 'apinex_zero_price' AND key = 'snapshot'"
    )
    .get() as { value: string };
  assert.deepEqual(JSON.parse(sourceAfterInvalidResponse.value), originalSource);

  const callsBeforeRead = urlCalls;
  modelsDev.getModelsDevZeroPriceEvidence();
  assert.equal(urlCalls, callsBeforeRead);

  modelsDev.saveModelsDevPricing({ unrelated: { "paid/model": { input: 0.1, output: 0.2 } } });
  const pricingAfterSave = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'models_dev_pricing' AND key = ?")
    .get(providerId) as { value: string };
  assert.deepEqual(JSON.parse(pricingAfterSave.value), {
    "free/persisted": { input: 0, output: 0 },
  });
  const sourceAfterSave = db
    .prepare(
      "SELECT value FROM key_value WHERE namespace = 'apinex_zero_price' AND key = 'snapshot'"
    )
    .get() as { value: string };
  assert.deepEqual(JSON.parse(sourceAfterSave.value), originalSource);

  modelsDev.clearModelsDevPricing();
  assert.equal(
    db
      .prepare(
        "SELECT value FROM key_value WHERE namespace = 'apinex_zero_price' AND key = 'snapshot'"
      )
      .get(),
    undefined
  );
});

test("persists only successful non-dry-run zero-price sync snapshots", async () => {
  delete process.env.MODELS_DEV_SYNC_ENABLED;
  const { getDbInstance } = await import("../../src/lib/db/core.ts");
  getDbInstance()
    .prepare(
      "DELETE FROM key_value WHERE namespace IN ('models_dev_pricing', 'models_dev_zero_price', 'apinex_zero_price')"
    )
    .run();
  const raw = {
    openrouter: {
      id: "openrouter",
      models: {
        "vendor/model:free": {
          id: "vendor/model:free",
          name: "Free",
          cost: { input: 0, output: 0 },
        },
      },
    },
  };
  const modelsDev = await importFresh("sync");

  assert.equal(typeof modelsDev.getModelsDevZeroPriceEvidence, "function");
  assert.equal(modelsDev.getModelsDevZeroPriceEvidence(), null);

  globalThis.fetch = async () =>
    new Response(JSON.stringify(raw), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const dryRun = await modelsDev.syncModelsDev({
    dryRun: true,
    syncCapabilities: false,
    maxRetries: 0,
  });
  assert.equal(dryRun.success, true);
  assert.equal(modelsDev.getModelsDevZeroPriceEvidence(), null);

  const synced = await modelsDev.syncModelsDev({ syncCapabilities: false, maxRetries: 0 });
  assert.equal(synced.success, true);
  const evidence = modelsDev.getModelsDevZeroPriceEvidence();
  assert.deepEqual(evidence.modelsByProvider, { openrouter: ["vendor/model:free"] });
  assert.ok(Number.isFinite(Date.parse(evidence.fetchedAt)));
  process.env.MODELS_DEV_SYNC_ENABLED = "false";
  assert.equal(modelsDev.getModelsDevZeroPriceEvidence(), null);
  delete process.env.MODELS_DEV_SYNC_ENABLED;

  globalThis.fetch = async () => {
    throw new Error("models.dev unavailable");
  };
  const failing = await importFresh("failure");
  const failed = await failing.syncModelsDev({ syncCapabilities: false, maxRetries: 0 });
  assert.equal(failed.success, false);
  assert.deepEqual(failing.getModelsDevZeroPriceEvidence(), evidence);

  failing.clearModelsDevPricing();
  assert.equal(failing.getModelsDevZeroPriceEvidence(), null);
});
