import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-compatible-metadata-"));
process.env.DATA_DIR = DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const metadata = await import("../../src/lib/providerModels/compatibleMetadata.ts");
const discovery = await import("../../src/lib/providerModels/modelDiscovery.ts");
const modelCapabilities = await import("../../src/lib/modelCapabilities.ts");
const modelMetadataRegistry = await import("../../src/lib/modelMetadataRegistry.ts");
const modelsDevSync = await import("../../src/lib/modelsDevSync.ts");

const NOW = "2026-10-29T12:00:00.000Z";
const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;
const PROVIDER_ID = "shared-compatible-metadata-node";
const CONNECTION_ID = "connection-1";
const SOURCE_URL = "https://gateway.example/v1/models";

mock.method(globalThis, "fetch", async () => {
  throw new Error("External HTTP is forbidden in compatible metadata unit tests");
});

test.beforeEach(() => {
  core.resetDbInstance();
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(DATA_DIR, { recursive: true });
});

test.after(async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  mock.restoreAll();
  core.resetDbInstance();
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("normalizes documented Anthropic and OpenAI rows with exact raw IDs", () => {
  assert.deepEqual(
    metadata.normalizeCompatibleModels([
      { id: "vendor/model:free", object: "model", created: 1735689600, owned_by: "vendor" },
      {
        id: "claude-sonnet-4-5",
        display_name: "Claude Sonnet 4.5",
        max_input_tokens: 200000,
        max_tokens: 64000,
        capabilities: {
          image_input: { supported: false },
          server_tools: {
            supported: true,
            code_execution: { supported: true },
          },
        },
      },
    ]),
    [
      { id: "vendor/model:free" },
      {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        inputTokenLimit: 200000,
        outputTokenLimit: 64000,
        supportsVision: false,
      },
    ]
  );
});

test("native structured-output declaration survives compatible import and resolution", async () => {
  const db = core.getDbInstance();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO provider_nodes (id, type, name, prefix, api_type, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(PROVIDER_ID, "openai-compatible", "Gateway", "gateway", "chat", SOURCE_URL, now, now);
  db.prepare(
    "INSERT INTO provider_connections (id, provider, name, is_active, provider_specific_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(CONNECTION_ID, PROVIDER_ID, "Active", 1, null, now, now);

  for (const structuredOutput of [true, false, undefined] as const) {
    modelsDevSync.saveModelsDevCapabilities({
      openai: {
        "gpt-4o": {
          tool_call: null,
          reasoning: null,
          attachment: null,
          structured_output: structuredOutput ?? null,
          temperature: null,
          modalities_input: "[]",
          modalities_output: "[]",
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
          reasoning_efforts: null,
        },
      },
    });

    const nativeRow = modelMetadataRegistry.enrichCatalogModelEntry(
      { id: "gpt-4o", owned_by: "openai", capabilities: {} },
      { provider: "openai", model: "gpt-4o" }
    );
    const nativeCapabilities = nativeRow.capabilities as Record<string, unknown>;
    if (structuredOutput === undefined) {
      assert.equal(Object.hasOwn(nativeCapabilities, "structured_output"), false);
    } else {
      assert.equal(nativeCapabilities.structured_output, structuredOutput);
    }

    await discovery.persistCompatibleDiscoveredModels(PROVIDER_ID, CONNECTION_ID, SOURCE_URL, [
      nativeRow,
    ]);
    const snapshot = await metadata.readCompatibleMetadataSnapshot(PROVIDER_ID, CONNECTION_ID);
    assert.ok(snapshot);
    const imported = snapshot.modelsById["gpt-4o"];
    if (structuredOutput === undefined) {
      assert.equal(Object.hasOwn(imported, "structuredOutput"), false);
    } else {
      assert.equal(imported.structuredOutput, structuredOutput);
    }

    const synced = await modelsDb.getSyncedAvailableModelsForConnection(PROVIDER_ID, CONNECTION_ID);
    if (structuredOutput === undefined) {
      assert.equal(Object.hasOwn(synced[0], "structuredOutput"), false);
    } else {
      assert.equal(synced[0].structuredOutput, structuredOutput);
    }
    assert.equal(
      modelCapabilities.getResolvedModelCapabilities(`${PROVIDER_ID}/gpt-4o`).structuredOutput,
      structuredOutput ?? null
    );
  }
});

test("only exact finite nonnegative per-million prices map, and explicit false survives", () => {
  const records = metadata.normalizeCompatibleModels([
    {
      id: "zero",
      supportsVision: false,
      dollarsPer1M: 0,
      outputDollarsPer1M: 0,
      cost: { input: 0, output: 0 },
      price: 0,
    },
    { id: "paid", dollarsPer1M: 0.25, outputDollarsPer1M: 0.75 },
    {
      id: "unknown",
      allowFree: true,
      fromDollarsPer1M: 0,
      input: 0,
      output: 0,
      price: 0,
      cost: { input: 0, output: 0 },
    },
    { id: "bad-string", dollarsPer1M: "0", outputDollarsPer1M: 0 },
    { id: "bad-negative", dollarsPer1M: -1, outputDollarsPer1M: 0 },
    { id: "bad-infinite", dollarsPer1M: Infinity, outputDollarsPer1M: 0 },
    { id: "partial-zero", dollarsPer1M: 0 },
  ]);

  assert.deepEqual(records, [
    { id: "zero", supportsVision: false, inputDollarsPer1M: 0, outputDollarsPer1M: 0 },
    { id: "paid", inputDollarsPer1M: 0.25, outputDollarsPer1M: 0.75 },
    { id: "unknown" },
    { id: "bad-string", outputDollarsPer1M: 0 },
    { id: "bad-negative", outputDollarsPer1M: 0 },
    { id: "bad-infinite", outputDollarsPer1M: 0 },
    { id: "partial-zero", inputDollarsPer1M: 0 },
  ]);
});

test("rejects malformed IDs, omits duplicate IDs, and accepts a complete empty catalog", () => {
  for (const value of [null, {}, [null], [{}]]) {
    assert.throws(() => metadata.normalizeCompatibleModels(value));
  }
  assert.deepEqual(
    metadata.normalizeCompatibleModels([
      { id: "same", supportsVision: false },
      { id: "unique" },
      { id: "same", supportsVision: true },
    ]),
    [{ id: "unique" }]
  );
  assert.deepEqual(metadata.normalizeCompatibleModels([]), []);
});

test("stores one current snapshot per exact provider and connection", async () => {
  await metadata.saveCompatibleMetadataSnapshot(
    PROVIDER_ID,
    CONNECTION_ID,
    SOURCE_URL,
    [{ id: "vendor/model:free", dollarsPer1M: 0, outputDollarsPer1M: 0 }],
    NOW
  );
  await metadata.saveCompatibleMetadataSnapshot(
    PROVIDER_ID,
    "connection-2",
    "https://second.example/v1/models",
    [{ id: "other/model" }],
    NOW
  );

  assert.deepEqual(await metadata.readCompatibleMetadataSnapshot(PROVIDER_ID, CONNECTION_ID), {
    providerId: PROVIDER_ID,
    connectionId: CONNECTION_ID,
    sourceUrl: SOURCE_URL,
    fetchedAt: NOW,
    modelsById: {
      "vendor/model:free": {
        id: "vendor/model:free",
        inputDollarsPer1M: 0,
        outputDollarsPer1M: 0,
      },
    },
  });
  assert.equal((await metadata.readCompatibleMetadataSnapshots()).length, 2);
});

test("reads explicit fields by exact provider, connection, and raw model ID", async () => {
  const rawModelId = "vendor/model:free";
  await metadata.saveCompatibleMetadataSnapshot(
    PROVIDER_ID,
    CONNECTION_ID,
    SOURCE_URL,
    [{ id: rawModelId, supportsVision: false }],
    NOW
  );

  assert.deepEqual(metadata.readCompatibleModelMetadata(PROVIDER_ID, CONNECTION_ID, rawModelId), {
    id: rawModelId,
    supportsVision: false,
  });
  assert.equal(metadata.readCompatibleModelMetadata("openai", CONNECTION_ID, rawModelId), null);
  assert.equal(
    metadata.readCompatibleModelMetadata(PROVIDER_ID, "other-connection", rawModelId),
    null
  );
  assert.equal(
    metadata.readCompatibleModelMetadata(PROVIDER_ID, CONNECTION_ID, "model:free"),
    null
  );
});

test("current eligibility respects active connections, node presence, and model exclusions", async () => {
  const db = core.getDbInstance();
  const now = new Date().toISOString();
  const excludedId = "vendor/model:excluded";
  const eligibleId = "vendor/model:free";
  db.prepare(
    "INSERT INTO provider_nodes (id, type, name, prefix, api_type, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(PROVIDER_ID, "anthropic-compatible", "Gateway", "gateway", "chat", SOURCE_URL, now, now);
  const insertConnection = db.prepare(
    "INSERT INTO provider_connections (id, provider, name, is_active, provider_specific_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  insertConnection.run(
    "active-connection",
    PROVIDER_ID,
    "Active",
    1,
    JSON.stringify({ excludedModels: [excludedId] }),
    now,
    now
  );
  insertConnection.run("inactive-connection", PROVIDER_ID, "Inactive", 0, null, now, now);
  insertConnection.run("orphan-connection", "missing-compatible-node", "Orphan", 1, null, now, now);
  const insertModels = db.prepare(
    "INSERT INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, ?)"
  );
  insertModels.run(
    `${PROVIDER_ID}:active-connection`,
    JSON.stringify([{ id: eligibleId }, { id: excludedId }])
  );
  insertModels.run(`${PROVIDER_ID}:inactive-connection`, JSON.stringify([{ id: eligibleId }]));
  insertModels.run(
    "missing-compatible-node:orphan-connection",
    JSON.stringify([{ id: eligibleId }])
  );
  await metadata.saveCompatibleMetadataSnapshot(PROVIDER_ID, "active-connection", SOURCE_URL, [
    { id: eligibleId, supportsVision: false },
    { id: excludedId, supportsVision: false },
  ]);
  await metadata.saveCompatibleMetadataSnapshot(PROVIDER_ID, "inactive-connection", SOURCE_URL, [
    { id: eligibleId, supportsVision: false },
  ]);

  const eligibleConnections = metadata.readCurrentCompatibleEligibleConnections();
  const snapshots = metadata.readCompatibleMetadataSnapshots();
  assert.deepEqual(eligibleConnections, [
    {
      providerId: PROVIDER_ID,
      connectionId: "active-connection",
      modelIds: [eligibleId],
    },
  ]);
  assert.equal(
    metadata.resolveCompatibleCapabilityOverride(
      snapshots,
      eligibleConnections,
      PROVIDER_ID,
      eligibleId,
      "supportsVision"
    ),
    false
  );
  assert.equal(
    metadata.resolveCompatibleCapabilityOverride(
      snapshots,
      eligibleConnections,
      PROVIDER_ID,
      excludedId,
      "supportsVision"
    ),
    null
  );
});

test("compatible capability overrides use eligible exact IDs and preserve explicit priority", () => {
  const providerId = "openai-compatible-node";
  const rawModelId = "vendor/model:free";
  const snapshot = (connectionId: string, supportsVision?: boolean) => ({
    providerId,
    connectionId,
    sourceUrl: SOURCE_URL,
    fetchedAt: "2025-01-01T00:00:00.000Z",
    modelsById: {
      [rawModelId]: {
        id: rawModelId,
        ...(supportsVision !== undefined ? { supportsVision } : {}),
      },
    },
  });
  const snapshots = [
    snapshot("active-false", false),
    snapshot("disabled-false", false),
    snapshot("active-unknown"),
  ];
  const eligibleConnections = [
    { providerId, connectionId: "active-false", modelIds: [rawModelId] },
    { providerId, connectionId: "active-unknown", modelIds: [rawModelId] },
    { providerId, connectionId: "active-excluded", modelIds: ["other/model"] },
  ];

  assert.equal(
    metadata.resolveCompatibleCapabilityOverride(
      snapshots,
      eligibleConnections,
      providerId,
      rawModelId,
      "supportsVision"
    ),
    false
  );
  assert.equal(
    metadata.resolveCompatibleCapabilityOverride(
      snapshots,
      [eligibleConnections[1]],
      providerId,
      rawModelId,
      "supportsVision"
    ),
    null
  );
  assert.equal(
    metadata.resolveCompatibleCapabilityOverride(
      snapshots,
      [eligibleConnections[2]],
      providerId,
      rawModelId,
      "supportsVision"
    ),
    null
  );
  assert.equal(
    metadata.resolveCompatibleCapabilityOverride(
      [snapshot("active-true", true)],
      [{ providerId, connectionId: "active-true", modelIds: [rawModelId] }],
      providerId,
      rawModelId,
      "supportsVision",
      false
    ),
    false
  );
  assert.equal(
    metadata.resolveCompatibleCapabilityOverride(
      snapshots,
      eligibleConnections,
      providerId,
      rawModelId,
      "supportsVision",
      true
    ),
    true
  );
});

test("composes only unanimous exact prices and uses oldest included source time", () => {
  const now = Date.parse(NOW);
  const providerId = "anthropic-compatible-node";
  const firstFetchedAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const secondFetchedAt = new Date(now - 60 * 60 * 1000).toISOString();
  const snapshots = [
    {
      providerId,
      connectionId: "connection-1",
      sourceUrl: SOURCE_URL,
      fetchedAt: firstFetchedAt,
      modelsById: {
        "shared/free": {
          id: "shared/free",
          inputDollarsPer1M: 0,
          outputDollarsPer1M: 0,
        },
        "shared/paid": {
          id: "shared/paid",
          inputDollarsPer1M: 0.2,
          outputDollarsPer1M: 0.4,
        },
      },
    },
    {
      providerId,
      connectionId: "connection-2",
      sourceUrl: SOURCE_URL,
      fetchedAt: secondFetchedAt,
      modelsById: {
        "shared/free": {
          id: "shared/free",
          inputDollarsPer1M: 0,
          outputDollarsPer1M: 0,
        },
        "shared/paid": {
          id: "shared/paid",
          inputDollarsPer1M: 0.2,
          outputDollarsPer1M: 0.4,
        },
      },
    },
  ];
  const eligibleConnections = ["connection-1", "connection-2"].map((connectionId) => ({
    providerId,
    connectionId,
    modelIds: ["shared/free", "shared/paid"],
  }));

  assert.deepEqual(metadata.composeCompatibleMetadataPrices(snapshots, eligibleConnections, now), {
    pricingByProvider: {
      [providerId]: {
        "shared/free": { input: 0, output: 0 },
        "shared/paid": { input: 0.2, output: 0.4 },
      },
    },
    zeroPriceModelsByProvider: { [providerId]: ["shared/free"] },
    fetchedAt: firstFetchedAt,
    zeroFetchedAt: firstFetchedAt,
  });
});

test("stale complete zero prices remain; missing, future, and conflicting data fail closed", () => {
  const now = Date.parse(NOW);
  const providerId = "openai-compatible-node";
  const modelId = "vendor/model";
  const eligible = ["connection-1", "connection-2"].map((connectionId) => ({
    providerId,
    connectionId,
    modelIds: [modelId],
  }));
  const makeSnapshot = (
    connectionId: string,
    fetchedAt = NOW,
    input = 0,
    output = 0,
    includeOutput = true
  ) => ({
    providerId,
    connectionId,
    sourceUrl: SOURCE_URL,
    fetchedAt,
    modelsById: {
      [modelId]: {
        id: modelId,
        inputDollarsPer1M: input,
        ...(includeOutput ? { outputDollarsPer1M: output } : {}),
      },
    },
  });
  const compose = (snapshots: ReturnType<typeof makeSnapshot>[]) =>
    metadata.composeCompatibleMetadataPrices(snapshots, eligible, now);

  const staleFetchedAt = new Date(now - THIRTY_SIX_HOURS_MS - 1).toISOString();
  const staleComplete = compose([
    makeSnapshot("connection-1", staleFetchedAt),
    makeSnapshot("connection-2"),
  ]);
  assert.deepEqual(staleComplete.pricingByProvider, {
    [providerId]: { [modelId]: { input: 0, output: 0 } },
  });
  assert.deepEqual(staleComplete.zeroPriceModelsByProvider, { [providerId]: [modelId] });
  assert.equal(staleComplete.fetchedAt, staleFetchedAt);

  assert.deepEqual(compose([makeSnapshot("connection-1")]).pricingByProvider, {});
  assert.deepEqual(
    compose([makeSnapshot("connection-1", NOW, 0, 0, false), makeSnapshot("connection-2")])
      .pricingByProvider,
    {}
  );
  assert.deepEqual(
    compose([
      makeSnapshot("connection-1", new Date(now + 1).toISOString()),
      makeSnapshot("connection-2"),
    ]).pricingByProvider,
    {}
  );
  assert.deepEqual(
    compose([makeSnapshot("connection-1"), makeSnapshot("connection-2", NOW, 0.1, 0.2)])
      .pricingByProvider,
    {}
  );
  assert.deepEqual(
    compose([
      makeSnapshot("connection-1", NOW, 0.1, 0.2),
      makeSnapshot("connection-2", NOW, 0.1, 0.2),
    ]).zeroPriceModelsByProvider,
    {}
  );
});

test("compatible price evidence stays bound to exact provider and raw model identity", () => {
  const providerId = "openai-compatible-node";
  const rawModelId = "vendor/model:free";
  const result = metadata.composeCompatibleMetadataPrices(
    [
      {
        providerId,
        connectionId: CONNECTION_ID,
        sourceUrl: SOURCE_URL,
        fetchedAt: NOW,
        modelsById: {
          [rawModelId]: { id: rawModelId, inputDollarsPer1M: 0, outputDollarsPer1M: 0 },
        },
      },
    ],
    [{ providerId, connectionId: CONNECTION_ID, modelIds: [rawModelId] }],
    Date.parse(NOW)
  );

  assert.deepEqual(result.zeroPriceModelsByProvider, { [providerId]: [rawModelId] });
  assert.equal(result.zeroPriceModelsByProvider.openai, undefined);
  assert.equal(result.pricingByProvider[providerId]?.[rawModelId]?.input, 0);
  assert.equal(result.pricingByProvider.openai?.[rawModelId], undefined);
});

test("preserves exact special raw keys without changing result prototypes", () => {
  const rawId = "__proto__";
  const result = metadata.composeCompatibleMetadataPrices(
    [
      {
        providerId: rawId,
        connectionId: CONNECTION_ID,
        sourceUrl: SOURCE_URL,
        fetchedAt: NOW,
        modelsById: Object.fromEntries([
          [rawId, { id: rawId, inputDollarsPer1M: 0, outputDollarsPer1M: 0 }],
        ]),
      },
    ],
    [{ providerId: rawId, connectionId: CONNECTION_ID, modelIds: [rawId] }],
    Date.parse(NOW)
  );

  assert.equal(Object.hasOwn(result.pricingByProvider, rawId), true);
  assert.equal(Object.hasOwn(result.pricingByProvider[rawId], rawId), true);
  assert.equal(Object.hasOwn(result.zeroPriceModelsByProvider, rawId), true);
  assert.deepEqual(result.zeroPriceModelsByProvider[rawId], [rawId]);
  assert.equal(Object.getPrototypeOf(result.pricingByProvider), Object.prototype);
});

test("malformed refresh preserves prior snapshot and duplicate IDs cannot retain metadata", async () => {
  const initial = [
    {
      id: "duplicate",
      dollarsPer1M: 0,
      outputDollarsPer1M: 0,
      supportsVision: false,
    },
  ];
  await metadata.saveCompatibleMetadataSnapshot(
    PROVIDER_ID,
    CONNECTION_ID,
    SOURCE_URL,
    initial,
    NOW
  );

  assert.throws(() =>
    metadata.saveCompatibleMetadataSnapshot(
      PROVIDER_ID,
      CONNECTION_ID,
      SOURCE_URL,
      [{ id: "valid/model" }, {}],
      "2026-10-29T13:00:00.000Z"
    )
  );
  assert.equal(
    (await metadata.readCompatibleMetadataSnapshot(PROVIDER_ID, CONNECTION_ID))?.fetchedAt,
    NOW
  );

  const replacementStartedAt = Date.now();
  const synced = await discovery.persistCompatibleDiscoveredModels(
    PROVIDER_ID,
    CONNECTION_ID,
    SOURCE_URL,
    [
      {
        id: "duplicate",
        dollarsPer1M: 0,
        outputDollarsPer1M: 0,
        supportsVision: false,
      },
      {
        id: "valid/model",
        dollarsPer1M: 0.25,
        outputDollarsPer1M: 0.75,
        supportsTools: true,
      },
      {
        id: "duplicate",
        dollarsPer1M: 0.5,
        outputDollarsPer1M: 1,
        supportsVision: true,
      },
    ]
  );
  const replacementFinishedAt = Date.now();
  assert.deepEqual(
    synced.map((model) => model.id),
    ["valid/model"]
  );
  assert.deepEqual(
    (await discovery.getCachedDiscoveredModels(PROVIDER_ID, CONNECTION_ID)).map(
      (model) => model.id
    ),
    ["valid/model"]
  );
  const replacement = await metadata.readCompatibleMetadataSnapshot(PROVIDER_ID, CONNECTION_ID);
  assert.ok(replacement);
  assert.ok(Date.parse(replacement.fetchedAt) >= replacementStartedAt);
  assert.ok(Date.parse(replacement.fetchedAt) <= replacementFinishedAt);
  assert.deepEqual(replacement, {
    providerId: PROVIDER_ID,
    connectionId: CONNECTION_ID,
    sourceUrl: SOURCE_URL,
    fetchedAt: replacement.fetchedAt,
    modelsById: {
      "valid/model": {
        id: "valid/model",
        supportsTools: true,
        inputDollarsPer1M: 0.25,
        outputDollarsPer1M: 0.75,
      },
    },
  });
  assert.equal(metadata.readCompatibleModelMetadata(PROVIDER_ID, CONNECTION_ID, "duplicate"), null);

  const eligibleConnections = [
    {
      providerId: PROVIDER_ID,
      connectionId: CONNECTION_ID,
      modelIds: ["duplicate", "valid/model"],
    },
  ];
  assert.equal(
    metadata.resolveCompatibleCapabilityOverride(
      [replacement],
      eligibleConnections,
      PROVIDER_ID,
      "duplicate",
      "supportsVision"
    ),
    null
  );
  const prices = metadata.composeCompatibleMetadataPrices(
    [replacement],
    eligibleConnections,
    Date.parse(replacement.fetchedAt)
  );
  assert.deepEqual(prices.pricingByProvider[PROVIDER_ID], {
    "valid/model": { input: 0.25, output: 0.75 },
  });
  assert.equal(Object.hasOwn(prices.pricingByProvider[PROVIDER_ID], "duplicate"), false);
  assert.equal(prices.zeroPriceModelsByProvider[PROVIDER_ID], undefined);
  assert.equal(prices.zeroFetchedAt, null);

  await metadata.saveCompatibleMetadataSnapshot(
    PROVIDER_ID,
    CONNECTION_ID,
    SOURCE_URL,
    [],
    "2026-10-29T15:00:00.000Z"
  );
  assert.deepEqual(await metadata.readCompatibleMetadataSnapshot(PROVIDER_ID, CONNECTION_ID), {
    providerId: PROVIDER_ID,
    connectionId: CONNECTION_ID,
    sourceUrl: SOURCE_URL,
    fetchedAt: "2026-10-29T15:00:00.000Z",
    modelsById: {},
  });
});

test("persists compatible source and regular available models together by exact connection", async () => {
  const rawModels = [
    {
      id: "claude-sonnet-4-5",
      display_name: "Claude Sonnet 4.5",
      max_input_tokens: 200000,
      max_tokens: 64000,
      supportsVision: false,
      supportsTools: true,
      dollarsPer1M: 3,
      outputDollarsPer1M: 15,
    },
  ];
  const synced = await discovery.persistCompatibleDiscoveredModels(
    PROVIDER_ID,
    CONNECTION_ID,
    SOURCE_URL,
    rawModels
  );

  assert.equal(synced[0]?.id, "claude-sonnet-4-5");
  assert.equal(synced[0]?.supportsVision, false);
  assert.equal(synced[0]?.supportsTools, true);
  const snapshot = await metadata.readCompatibleMetadataSnapshot(PROVIDER_ID, CONNECTION_ID);
  assert.equal(snapshot?.modelsById["claude-sonnet-4-5"]?.supportsVision, false);
  assert.equal(snapshot?.modelsById["claude-sonnet-4-5"]?.supportsTools, true);
  assert.equal(snapshot?.modelsById["claude-sonnet-4-5"]?.inputDollarsPer1M, 3);

  await assert.rejects(() =>
    discovery.persistCompatibleDiscoveredModels(PROVIDER_ID, CONNECTION_ID, SOURCE_URL, [
      { id: "invalid" },
      {},
    ])
  );
  assert.equal(
    (await metadata.readCompatibleMetadataSnapshot(PROVIDER_ID, CONNECTION_ID))?.modelsById[
      "claude-sonnet-4-5"
    ]?.inputDollarsPer1M,
    3
  );

  await discovery.persistCompatibleDiscoveredModels(PROVIDER_ID, CONNECTION_ID, SOURCE_URL, []);
  assert.deepEqual(
    (await metadata.readCompatibleMetadataSnapshot(PROVIDER_ID, CONNECTION_ID))?.modelsById,
    {}
  );
});
