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

test("persists only successful non-dry-run zero-price sync snapshots", async () => {
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
