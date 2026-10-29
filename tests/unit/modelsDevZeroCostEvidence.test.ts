import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractModelsDevZeroPriceModels,
  type ModelsDevData,
} from "../../src/lib/modelsDevSync/transform.ts";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-zero-price-"));
process.env.DATA_DIR = DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const compatibleMetadata = await import("../../src/lib/providerModels/compatibleMetadata.ts");
const strictZeroCostFilter =
  await import("../../open-sse/services/autoCombo/strictZeroCostFilter.ts");
const modulePath = path.join(process.cwd(), "src/lib/modelsDevSync.ts");
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const loadedModules = new Set<{ stopPeriodicSync?: () => void }>();

const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const PROVIDER_ID = "shared-compatible-metadata-node";
const CONNECTION_ID = "connection-compatible";
const SOURCE_URL = "https://gateway.example/v1/models";

async function importFresh(label: string) {
  const { pathToFileURL } = await import("node:url");
  const mod = await import(`${pathToFileURL(modulePath).href}?zero-price-${label}-${Date.now()}`);
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

function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function insertCompatibleNode(modelIds: string[]) {
  const db = core.getDbInstance();
  const now = new Date(NOW).toISOString();
  db.prepare(
    "INSERT INTO provider_nodes (id, type, name, prefix, api_type, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    PROVIDER_ID,
    "openai-compatible",
    "Gateway",
    "gateway",
    "chat",
    "https://gateway.example/v1",
    now,
    now
  );
  db.prepare(
    "INSERT INTO provider_connections (id, provider, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
  ).run(CONNECTION_ID, PROVIDER_ID, "Gateway connection", now, now);
  db.prepare(
    "INSERT INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, ?)"
  ).run(
    `${PROVIDER_ID}:${CONNECTION_ID}`,
    JSON.stringify(modelIds.map((id) => ({ id, name: id, source: "imported" })))
  );
}

test.beforeEach(() => resetStorage());

test.afterEach(() => {
  for (const mod of loadedModules) mod.stopPeriodicSync?.();
  loadedModules.clear();
  globalThis.fetch = originalFetch;
  restoreEnv();
  core.resetDbInstance();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("models.dev zero-price extraction preserves canonical provider and raw model IDs", () => {
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
        "nonzero-output": {
          id: "nonzero-output",
          name: "Paid",
          cost: { input: 0, output: 0.01 },
        },
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
        partial: { id: "partial", name: "Unknown", cost: { input: 0 } },
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

test("persists only successful non-dry-run models.dev zero-price snapshots", async () => {
  delete process.env.MODELS_DEV_SYNC_ENABLED;
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
  const modelsDev = await importFresh("models-dev-save");
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
  assert.deepEqual(evidence?.modelsByProvider, { openrouter: ["vendor/model:free"] });
  assert.ok(evidence && Number.isFinite(Date.parse(evidence.fetchedAt)));

  process.env.MODELS_DEV_SYNC_ENABLED = "false";
  assert.equal(modelsDev.getModelsDevZeroPriceEvidence(), null);
  delete process.env.MODELS_DEV_SYNC_ENABLED;

  globalThis.fetch = async () => {
    throw new Error("models.dev unavailable");
  };
  const failedModule = await importFresh("models-dev-failure");
  const failed = await failedModule.syncModelsDev({ syncCapabilities: false, maxRetries: 0 });
  assert.equal(failed.success, false);
  assert.deepEqual(failedModule.getModelsDevZeroPriceEvidence(), evidence);

  failedModule.clearModelsDevPricing();
  assert.equal(failedModule.getModelsDevZeroPriceEvidence(), null);
});

test("strict zero evidence reads both fresh sources without network or writes", async () => {
  process.env.MODELS_DEV_SYNC_ENABLED = "true";
  const rawModelId = "vendor/model:free";
  insertCompatibleNode([rawModelId]);
  const compatibleFetchedAt = new Date(NOW - 12 * 60 * 60 * 1000).toISOString();
  await compatibleMetadata.saveCompatibleMetadataSnapshot(
    PROVIDER_ID,
    CONNECTION_ID,
    SOURCE_URL,
    [{ id: rawModelId, dollarsPer1M: 0, outputDollarsPer1M: 0 }],
    compatibleFetchedAt
  );

  const modelsDevFetchedAt = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
  core
    .getDbInstance()
    .prepare(
      "INSERT INTO key_value (namespace, key, value) VALUES ('models_dev_zero_price', 'snapshot', ?)"
    )
    .run(
      JSON.stringify({
        fetchedAt: modelsDevFetchedAt,
        modelsByProvider: { openrouter: ["router/free"] },
      })
    );

  const modelsDev = await importFresh("read-composed");
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("read must stay local");
  };
  const beforeCount = core
    .getDbInstance()
    .prepare("SELECT COUNT(*) AS count FROM key_value")
    .get() as { count: number };
  const evidence = modelsDev.getModelsDevZeroPriceEvidence();
  const afterCount = core
    .getDbInstance()
    .prepare("SELECT COUNT(*) AS count FROM key_value")
    .get() as { count: number };

  assert.equal(fetches, 0);
  assert.equal(afterCount.count, beforeCount.count);
  assert.deepEqual(evidence, {
    fetchedAt: compatibleFetchedAt,
    modelsByProvider: {
      openrouter: ["router/free"],
      [PROVIDER_ID]: [rawModelId],
    },
  });

  const exactCompatible = { provider: PROVIDER_ID, model: rawModelId, connectionId: CONNECTION_ID };
  const canonicalProvider = { provider: "openrouter", model: "router/free" };
  const wrongCanonical = { provider: "openrouter", model: rawModelId };
  assert.deepEqual(
    strictZeroCostFilter.filterStrictZeroCostCandidates(
      [exactCompatible, canonicalProvider, wrongCanonical],
      {
        enabled: true,
        catalog: [],
        resolveFreeAccessState: () => undefined,
        minRemainingAllowance: 0,
        maxStateAgeMs: 60_000,
        modelsDevZeroPriceEvidence: evidence,
      }
    ),
    [exactCompatible]
  );
});

test("stale and future compatible snapshots do not contribute current zero evidence", () => {
  const rawModelId = "vendor/model:free";
  const eligibleConnections = [
    { providerId: PROVIDER_ID, connectionId: CONNECTION_ID, modelIds: [rawModelId] },
  ];
  const snapshot = (fetchedAt: string) => ({
    providerId: PROVIDER_ID,
    connectionId: CONNECTION_ID,
    sourceUrl: SOURCE_URL,
    fetchedAt,
    modelsById: { [rawModelId]: { id: rawModelId, inputDollarsPer1M: 0, outputDollarsPer1M: 0 } },
  });

  for (const fetchedAt of [
    new Date(NOW - compatibleMetadata.COMPATIBLE_METADATA_MAX_AGE_MS - 1).toISOString(),
    new Date(NOW + 1).toISOString(),
  ]) {
    assert.deepEqual(
      compatibleMetadata.composeCompatibleMetadataPrices(
        [snapshot(fetchedAt)],
        eligibleConnections,
        NOW
      ).zeroPriceModelsByProvider,
      {}
    );
  }
});
