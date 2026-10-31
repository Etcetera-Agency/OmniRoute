import test from "node:test";
import assert from "node:assert/strict";
import {
  extractModelsDevZeroPriceModels,
  transformModelsDevToPricing,
  type ModelsDevData,
} from "../../src/lib/modelsDevSync/transform.ts";
import { FREE_MODEL_BUDGETS } from "../../open-sse/config/freeModelCatalog.ts";
import { classifyStrictZeroCostCandidate } from "../../open-sse/services/autoCombo/strictZeroCostFilter.ts";

const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const STALE_FETCHED_AT = "2026-10-29T23:31:57.808Z";
const KILO_MODEL_ID = "dots-studio/dots-3-note-preview:free";

const RAW_MODELS = {
  kilo: {
    id: "kilo",
    models: {
      [KILO_MODEL_ID]: {
        id: "embedded-id-is-not-the-key",
        name: "Dots 3 Note Preview",
        structured_output: true,
        cost: { input: 0, output: 0 },
      },
      "nonzero-output": {
        id: "nonzero-output",
        name: "Paid",
        cost: { input: 0, output: 0.01 },
      },
      "missing-output": {
        id: "missing-output",
        name: "Incomplete",
        cost: { input: 0 },
      },
      "nonzero-audio": {
        id: "nonzero-audio",
        name: "Audio priced",
        cost: { input: 0, output: 0, input_audio: 0.01 },
      },
    },
  },
  openrouter: {
    id: "openrouter",
    models: {
      free: {
        id: "openrouter/free",
        name: "Dynamic free route",
        cost: { input: 0, output: 0 },
      },
    },
  },
} as unknown as ModelsDevData;

function options(modelsByProvider: Record<string, string[]> | undefined) {
  return {
    minRemainingAllowance: 0,
    maxStateAgeMs: 60_000,
    now: () => NOW,
    modelsDevZeroPriceEvidence: modelsByProvider
      ? { fetchedAt: STALE_FETCHED_AT, modelsByProvider }
      : null,
  };
}

test("zero-price import maps raw provider, preserves exact ID, and matches native pricing", () => {
  const evidence = extractModelsDevZeroPriceModels(RAW_MODELS);
  const nativePricing = transformModelsDevToPricing(RAW_MODELS);

  assert.deepEqual(evidence, {
    kilocode: [KILO_MODEL_ID],
    kc: [KILO_MODEL_ID],
    "kilo-gateway": [KILO_MODEL_ID],
  });
  assert.deepEqual(Object.keys(nativePricing), ["kilocode", "kc", "kilo-gateway", "openrouter"]);
  assert.deepEqual(Object.keys(nativePricing.kilocode), [
    KILO_MODEL_ID,
    "nonzero-output",
    "missing-output",
    "nonzero-audio",
  ]);
  assert.ok(nativePricing.openrouter.free);
  assert.equal(evidence.kilocode.includes("embedded-id-is-not-the-key"), false);
  assert.equal(evidence.openrouter, undefined);
});

test("mapped provider precedence matches the final native provider model set", () => {
  const collisionModel = "shared/model";
  const earlierOnlyModel = "earlier-only/model";
  const finalZeroModel = "final-zero/model";
  const raw = {
    kilo: {
      id: "kilo",
      models: {
        [collisionModel]: {
          id: collisionModel,
          name: "Earlier zero",
          cost: { input: 0, output: 0 },
        },
        [earlierOnlyModel]: {
          id: earlierOnlyModel,
          name: "Earlier only",
          cost: { input: 0, output: 0 },
        },
        [finalZeroModel]: {
          id: finalZeroModel,
          name: "Earlier paid",
          cost: { input: 0.01, output: 0 },
        },
      },
    },
    kilocode: {
      id: "kilocode",
      models: {
        [collisionModel]: {
          id: collisionModel,
          name: "Later paid",
          cost: { input: 0.01, output: 0 },
        },
        [finalZeroModel]: {
          id: finalZeroModel,
          name: "Final zero",
          cost: { input: 0, output: 0 },
        },
      },
    },
  } as unknown as ModelsDevData;
  const evidence = extractModelsDevZeroPriceModels(raw);
  const nativePricing = transformModelsDevToPricing(raw);
  const canonicalPrices = nativePricing.kilocode;

  assert.equal(canonicalPrices[collisionModel].input, 0.01);
  assert.equal(canonicalPrices[finalZeroModel].input, 0);
  assert.equal(canonicalPrices[finalZeroModel].output, 0);
  assert.equal(canonicalPrices[earlierOnlyModel].input, 0);
  assert.deepEqual(evidence, {
    kilocode: [finalZeroModel],
    kc: [finalZeroModel],
    "kilo-gateway": [finalZeroModel],
  });

  assert.deepEqual(
    classifyStrictZeroCostCandidate(
      { provider: "kilocode", model: collisionModel, connectionId: "kilocode-connection" },
      undefined,
      () => undefined,
      options(evidence)
    ),
    { outcome: "not-in-catalog" }
  );
  assert.deepEqual(
    classifyStrictZeroCostCandidate(
      { provider: "kilocode", model: finalZeroModel, connectionId: "kilocode-connection" },
      undefined,
      () => undefined,
      options(evidence)
    ),
    { outcome: "safe", safeConnectionIds: ["kilocode-connection"] }
  );
  assert.deepEqual(
    classifyStrictZeroCostCandidate(
      { provider: "kilocode", model: earlierOnlyModel, connectionId: "kilocode-connection" },
      undefined,
      () => undefined,
      options(evidence)
    ),
    { outcome: "not-in-catalog" }
  );
});

test("exact structured-output zero-price evidence remains usable after 36 hours", () => {
  const evidence = extractModelsDevZeroPriceModels(RAW_MODELS);
  const verdict = classifyStrictZeroCostCandidate(
    {
      provider: "kilocode",
      model: KILO_MODEL_ID,
      connectionId: "kilocode-connection",
    },
    undefined,
    () => undefined,
    options(evidence)
  );

  assert.deepEqual(verdict, {
    outcome: "safe",
    safeConnectionIds: ["kilocode-connection"],
  });
});

test("persisted stale models.dev snapshot keeps fetchedAt provenance and reaches strict filter", async () => {
  const previousSyncEnabled = process.env.MODELS_DEV_SYNC_ENABLED;
  process.env.MODELS_DEV_SYNC_ENABLED = "true";
  const core = await import("../../src/lib/db/core.ts");
  const modelsDev = await import("../../src/lib/modelsDevSync.ts");
  const db = core.getDbInstance();
  const imported = extractModelsDevZeroPriceModels(RAW_MODELS);

  try {
    db.prepare(
      "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('models_dev_zero_price', 'snapshot', ?)"
    ).run(JSON.stringify({ fetchedAt: STALE_FETCHED_AT, modelsByProvider: imported }));

    const evidence = modelsDev.getModelsDevZeroPriceEvidence();
    assert.equal(evidence?.fetchedAt, STALE_FETCHED_AT);
    assert.deepEqual(
      classifyStrictZeroCostCandidate(
        {
          provider: "kilocode",
          model: KILO_MODEL_ID,
          connectionId: "kilocode-connection",
        },
        undefined,
        () => undefined,
        {
          ...options(evidence?.modelsByProvider),
          modelsDevZeroPriceEvidence: evidence,
        }
      ),
      { outcome: "safe", safeConnectionIds: ["kilocode-connection"] }
    );

    for (const fetchedAt of [new Date(Date.now() + 60_000).toISOString(), "not-a-timestamp"]) {
      db.prepare(
        "UPDATE key_value SET value = ? WHERE namespace = 'models_dev_zero_price' AND key = 'snapshot'"
      ).run(JSON.stringify({ fetchedAt, modelsByProvider: imported }));
      assert.equal(modelsDev.getModelsDevZeroPriceEvidence(), null);
    }
  } finally {
    db.prepare(
      "DELETE FROM key_value WHERE namespace = 'models_dev_zero_price' AND key = 'snapshot'"
    ).run();
    if (previousSyncEnabled === undefined) delete process.env.MODELS_DEV_SYNC_ENABLED;
    else process.env.MODELS_DEV_SYNC_ENABLED = previousSyncEnabled;
  }
});

test("missing evidence and non-exact model IDs do not qualify", () => {
  const evidence = extractModelsDevZeroPriceModels(RAW_MODELS);
  for (const [model, imported] of [
    [KILO_MODEL_ID, undefined],
    ["different-model-id", evidence],
    ["nonzero-output", evidence],
    ["missing-output", evidence],
    ["nonzero-audio", evidence],
  ] as const) {
    assert.deepEqual(
      classifyStrictZeroCostCandidate(
        { provider: "kilocode", model, connectionId: "kilocode-connection" },
        undefined,
        () => undefined,
        options(imported)
      ),
      { outcome: "not-in-catalog" }
    );
  }
});

test("dynamic openrouter/free remains excluded", () => {
  assert.deepEqual(
    classifyStrictZeroCostCandidate(
      { provider: "openrouter", model: "openrouter/free", connectionId: "openrouter-connection" },
      undefined,
      () => undefined,
      options({ openrouter: ["openrouter/free"] })
    ),
    { outcome: "not-in-catalog" }
  );
});

test("static catalog hard-stop and quota checks retain precedence", () => {
  const budget = FREE_MODEL_BUDGETS.find(
    (entry) => entry.provider === "groq" && entry.modelId === "openai/gpt-oss-120b"
  );
  assert.ok(budget);
  const candidate = {
    provider: budget.provider,
    model: budget.modelId,
    connectionId: "groq-connection",
  };
  const staleExactEvidence = options({ [budget.provider]: [budget.modelId] });
  const safeState = {
    status: "SAFE" as const,
    remainingFreeAllowance: 20,
    resetAt: null,
    checkedAt: new Date(NOW).toISOString(),
  };

  assert.deepEqual(
    classifyStrictZeroCostCandidate(
      candidate,
      { ...budget, hardStopGuaranteed: false },
      () => safeState,
      staleExactEvidence
    ),
    { outcome: "no-hard-stop" }
  );
  assert.deepEqual(
    classifyStrictZeroCostCandidate(
      candidate,
      budget,
      () => ({ ...safeState, status: "EXHAUSTED", remainingFreeAllowance: 0 }),
      staleExactEvidence
    ),
    { outcome: "exhausted" }
  );
  assert.deepEqual(
    classifyStrictZeroCostCandidate(candidate, budget, () => undefined, staleExactEvidence),
    { outcome: "state-unknown" }
  );
});
