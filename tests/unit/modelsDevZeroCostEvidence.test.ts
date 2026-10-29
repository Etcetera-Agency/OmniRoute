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
import {
  APINEX_PUBLIC_MODELS_URL,
  bindApinexZeroPriceModels,
  composeFreshZeroPriceEvidence,
  extractApinexZeroPriceModelIds,
  type ApinexZeroPriceEvidence,
} from "../../src/lib/modelsDevSync/apinex.ts";

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
const APINEX_NODE = "openai-compatible-chat-apinex-test";

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

test("binds APInex zero IDs only to exact configured endpoint and synced raw IDs", () => {
  const bound = bindApinexZeroPriceModels(
    ["free/exact", "free/unavailable"],
    [
      {
        id: APINEX_NODE,
        type: "openai-compatible-chat",
        baseUrl: "https://api.apinex.bond/v1",
        availableModelIds: ["free/exact", "free/other"],
      },
      {
        id: "openai-compatible-chat-other-host",
        type: "openai-compatible-chat",
        baseUrl: "https://other.example/v1",
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

  assert.deepEqual(bound, { [APINEX_NODE]: ["free/exact"] });
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

async function createApinexTestNode(
  id: string,
  baseUrl: string,
  models: Array<{ id: string; visibility?: "hide" | "list" }>
) {
  const { createProviderNode } = await import("../../src/lib/db/providers/nodes.ts");
  const { getDbInstance } = await import("../../src/lib/db/core.ts");
  await createProviderNode({
    id,
    type: "openai-compatible-chat",
    name: "Display name is not identity",
    prefix: "display-prefix",
    baseUrl,
  });
  getDbInstance()
    .prepare("INSERT INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, ?)")
    .run(`${id}:tl324-connection`, JSON.stringify(models));
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

test("syncs only exact APInex zero IDs already synced under configured node", async () => {
  delete process.env.MODELS_DEV_SYNC_ENABLED;
  const db = await createApinexTestNode(APINEX_NODE, "https://api.apinex.bond/v1", [
    { id: "free/exact-zero", visibility: "hide" },
    { id: "free/other" },
    { id: "free/mixed" },
  ]);
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
          models: [
            apinexRecord("free/exact-zero"),
            apinexRecord("free/not-synced"),
            apinexRecord("free/mixed", 0, 0.01),
          ],
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
  assert.deepEqual(source.modelsByProvider, { [APINEX_NODE]: ["free/exact-zero"] });

  const pricingRow = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'models_dev_pricing' AND key = ?")
    .get(APINEX_NODE) as { value: string };
  assert.deepEqual(JSON.parse(pricingRow.value), { "free/exact-zero": { input: 0, output: 0 } });
  assert.deepEqual(modelsDev.getModelsDevZeroPriceEvidence().modelsByProvider[APINEX_NODE], [
    "free/exact-zero",
  ]);

  db.prepare("DELETE FROM key_value WHERE namespace = 'models_dev_zero_price'").run();
  assert.deepEqual(modelsDev.getModelsDevZeroPriceEvidence(), {
    fetchedAt: source.fetchedAt,
    modelsByProvider: { [APINEX_NODE]: ["free/exact-zero"] },
  });

  const storedModels = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'syncedAvailableModels' AND key = ?")
    .get(`${APINEX_NODE}:tl324-connection`) as { value: string };
  assert.deepEqual(JSON.parse(storedModels.value), [
    { id: "free/exact-zero", visibility: "hide" },
    { id: "free/other" },
    { id: "free/mixed" },
  ]);

  db.prepare("UPDATE provider_nodes SET base_url = 'https://other.example/v1' WHERE id = ?").run(
    APINEX_NODE
  );
  assert.equal(modelsDev.getModelsDevZeroPriceEvidence(), null);
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
