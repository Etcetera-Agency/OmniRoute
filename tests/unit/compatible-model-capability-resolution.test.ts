import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-compatible-capability-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const modelCapabilities = await import("../../src/lib/modelCapabilities.ts");
const modelsDevSync = await import("../../src/lib/modelsDevSync.ts");

mock.method(globalThis, "fetch", async () => {
  throw new Error("External HTTP is forbidden in compatible capability unit tests");
});

const providerId = "openai-compatible-local";
const rawModelId = "gpt-4o";
const crossProviderModelId = "deepseek-v4.1-flash";

function syncedCapability(structured_output, tool_call = null) {
  return {
    tool_call,
    reasoning: null,
    reasoning_efforts: null,
    attachment: null,
    structured_output,
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
  };
}

function compatibleSnapshot(overrides = {}) {
  return {
    synced: new Map(),
    maxTokenOverrides: new Map(),
    maxInputTokenOverrides: new Map(),
    reasoningEffortsOverrides: new Map(),
    contextOverrides: new Map(),
    customVisionOverrides: new Map(),
    customModelsByProvider: new Map(),
    compatVisionOverrides: new Map(),
    syncedAvailableModelVision: new Map(),
    compatibleMetadataSnapshots: [
      {
        providerId,
        connectionId: "connection-a",
        sourceUrl: "https://example.test/models",
        fetchedAt: "2026-10-29T00:00:00.000Z",
        modelsById: { [rawModelId]: { id: rawModelId, supportsVision: false } },
      },
      {
        providerId,
        connectionId: "connection-b",
        sourceUrl: "https://example.test/models",
        fetchedAt: "2026-10-29T00:00:00.000Z",
        modelsById: { [rawModelId]: { id: rawModelId, supportsVision: true } },
      },
    ],
    compatibleEligibleConnections: [
      { providerId, connectionId: "connection-a", modelIds: [rawModelId] },
      { providerId, connectionId: "connection-b", modelIds: [rawModelId] },
    ],
    ...overrides,
  };
}

function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(resetStorage);

test.after(() => {
  mock.restoreAll();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("an active compatible source false beats canonical true across connections", () => {
  const canonical = modelCapabilities.getResolvedModelCapabilities(`${providerId}/${rawModelId}`);
  assert.equal(canonical.supportsVision, true);

  const resolved = modelCapabilities.getResolvedModelCapabilities(
    `${providerId}/${rawModelId}`,
    undefined,
    compatibleSnapshot()
  );
  assert.equal(resolved.supportsVision, false);
});

test("an active compatible tool-use false beats canonical true across connections", () => {
  const base = compatibleSnapshot();
  const snapshot = {
    ...base,
    compatibleMetadataSnapshots: base.compatibleMetadataSnapshots.map((metadata) => ({
      ...metadata,
      modelsById: {
        [rawModelId]: {
          id: rawModelId,
          supportsTools: metadata.connectionId === "connection-a" ? false : true,
        },
      },
    })),
  };
  const resolved = modelCapabilities.getResolvedModelCapabilities(
    `${providerId}/${rawModelId}`,
    undefined,
    snapshot
  );
  assert.equal(resolved.supportsTools, false);
});

test("a compatible false cannot override an explicit operator vision override", () => {
  const snapshot = compatibleSnapshot({
    compatVisionOverrides: new Map([[providerId, new Map([[rawModelId, true]])]]),
  });
  const resolved = modelCapabilities.getResolvedModelCapabilities(
    `${providerId}/${rawModelId}`,
    undefined,
    snapshot
  );
  assert.equal(resolved.supportsVision, true);
});

test("unknown compatible capability leaves the canonical verdict unchanged", () => {
  const snapshot = compatibleSnapshot({
    compatibleMetadataSnapshots: [
      {
        providerId,
        connectionId: "connection-a",
        sourceUrl: "https://example.test/models",
        fetchedAt: "2026-10-29T00:00:00.000Z",
        modelsById: { [rawModelId]: { id: rawModelId } },
      },
    ],
    compatibleEligibleConnections: [
      { providerId, connectionId: "connection-a", modelIds: [rawModelId] },
    ],
  });
  const resolved = modelCapabilities.getResolvedModelCapabilities(
    `${providerId}/${rawModelId}`,
    undefined,
    snapshot
  );
  assert.equal(resolved.supportsVision, true);
});

test("structured-output handoff keeps false veto, true evidence, exact identity, and priority", () => {
  const base = compatibleSnapshot({
    compatibleMetadataSnapshots: [
      {
        providerId,
        connectionId: "connection-a",
        sourceUrl: "https://example.test/models",
        fetchedAt: "2026-10-29T00:00:00.000Z",
        modelsById: { [rawModelId]: { id: rawModelId, structuredOutput: false } },
      },
      {
        providerId,
        connectionId: "connection-b",
        sourceUrl: "https://example.test/models",
        fetchedAt: "2026-10-29T00:00:00.000Z",
        modelsById: { [rawModelId]: { id: rawModelId, structuredOutput: true } },
      },
    ],
  });
  const resolved = modelCapabilities.getResolvedModelCapabilities(
    `${providerId}/${rawModelId}`,
    undefined,
    base
  );
  assert.equal(resolved.structuredOutput, false);

  const trueOnly = {
    ...base,
    compatibleMetadataSnapshots: base.compatibleMetadataSnapshots.slice(1),
    compatibleEligibleConnections: base.compatibleEligibleConnections.slice(1),
  };
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities(
      `${providerId}/${rawModelId}`,
      undefined,
      trueOnly
    ).structuredOutput,
    true
  );

  const absent = {
    ...trueOnly,
    compatibleMetadataSnapshots: [
      {
        providerId,
        connectionId: "connection-b",
        sourceUrl: "https://example.test/models",
        fetchedAt: "2026-10-29T00:00:00.000Z",
        modelsById: { [rawModelId]: { id: rawModelId } },
      },
    ],
  };
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities(`${providerId}/${rawModelId}`, undefined, absent)
      .structuredOutput,
    null
  );

  const otherModel = {
    ...trueOnly,
    compatibleEligibleConnections: [
      { providerId, connectionId: "connection-b", modelIds: ["different-model"] },
    ],
  };
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities(
      `${providerId}/${rawModelId}`,
      undefined,
      otherModel
    ).structuredOutput,
    null
  );

  const otherProvider = {
    ...trueOnly,
    compatibleEligibleConnections: [
      { providerId: "other-compatible-node", connectionId: "connection-b", modelIds: [rawModelId] },
    ],
  };
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities(
      `${providerId}/${rawModelId}`,
      undefined,
      otherProvider
    ).structuredOutput,
    null
  );

  const otherConnection = {
    ...trueOnly,
    compatibleMetadataSnapshots: [
      {
        ...trueOnly.compatibleMetadataSnapshots[0],
        connectionId: "connection-a",
      },
    ],
  };
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities(
      `${providerId}/${rawModelId}`,
      undefined,
      otherConnection
    ).structuredOutput,
    null
  );

  const higherPriority = {
    ...base,
    synced: {
      [providerId]: {
        [rawModelId]: { structured_output: true },
      },
    },
  };
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities(
      `${providerId}/${rawModelId}`,
      undefined,
      higherPriority
    ).structuredOutput,
    true
  );

  const higherPriorityFalse = {
    ...higherPriority,
    synced: {
      [providerId]: {
        [rawModelId]: { structured_output: false },
      },
    },
  };
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities(
      `${providerId}/${rawModelId}`,
      undefined,
      higherPriorityFalse
    ).structuredOutput,
    false
  );
});

test("native models.dev structured-output booleans keep priority over other providers", () => {
  modelsDevSync.saveModelsDevCapabilities({
    "opencode-go": {
      [crossProviderModelId]: syncedCapability(true),
    },
    "alibaba-token-plan": {
      [crossProviderModelId]: syncedCapability(false),
    },
  });

  assert.equal(
    modelCapabilities.getResolvedModelCapabilities({
      provider: "opencode-go",
      model: crossProviderModelId,
    }).structuredOutput,
    true
  );
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities({
      provider: "alibaba-token-plan",
      model: crossProviderModelId,
    }).structuredOutput,
    false
  );
});

test("any exact cross-provider models.dev true resolves regardless of false rows or order", () => {
  for (const entries of [
    [
      ["alibaba-token-plan", false],
      ["opencode-go", true],
    ],
    [
      ["opencode-go", true],
      ["alibaba-token-plan", false],
    ],
  ]) {
    modelsDevSync.saveModelsDevCapabilities(
      Object.fromEntries(
        entries.map(([provider, structuredOutput]) => [
          provider,
          { [crossProviderModelId]: syncedCapability(structuredOutput) },
        ])
      )
    );

    assert.equal(
      modelCapabilities.getResolvedModelCapabilities({
        provider: providerId,
        model: crossProviderModelId,
      }).structuredOutput,
      true
    );
  }

  const snapshot = compatibleSnapshot({
    synced: {
      "alibaba-token-plan": {
        [crossProviderModelId]: syncedCapability(false),
      },
      "opencode-go": {
        [crossProviderModelId]: syncedCapability(true, false),
      },
    },
  });
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities(
      `${providerId}/${crossProviderModelId}`,
      undefined,
      snapshot
    ).structuredOutput,
    true
  );

  modelsDevSync.saveModelsDevCapabilities({
    "opencode-go": {
      [crossProviderModelId]: syncedCapability(true, false),
    },
  });
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities({
      provider: providerId,
      model: crossProviderModelId,
    }).structuredOutput,
    true
  );
});

test("false, null, tool-call-only, and similar model rows do not prove structured output", () => {
  modelsDevSync.saveModelsDevCapabilities({
    "alibaba-token-plan": {
      [crossProviderModelId]: syncedCapability(false),
    },
    "ollama-cloud": {
      [crossProviderModelId]: syncedCapability(null, true),
    },
    "opencode-go": {
      [`${crossProviderModelId}-preview`]: syncedCapability(true),
    },
  });

  assert.equal(
    modelCapabilities.getResolvedModelCapabilities({
      provider: providerId,
      model: crossProviderModelId,
    }).structuredOutput,
    null
  );
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities({
      provider: providerId,
      model: `${crossProviderModelId}-preview-v2`,
    }).structuredOutput,
    null
  );
});

test("exact compatible false still vetoes cross-provider models.dev true", () => {
  const base = compatibleSnapshot({
    synced: {
      "opencode-go": {
        [rawModelId]: syncedCapability(true),
      },
    },
    compatibleMetadataSnapshots: [
      {
        providerId,
        connectionId: "connection-a",
        sourceUrl: "https://example.test/models",
        fetchedAt: "2026-10-29T00:00:00.000Z",
        modelsById: { [rawModelId]: { id: rawModelId, structuredOutput: false } },
      },
    ],
    compatibleEligibleConnections: [
      { providerId, connectionId: "connection-a", modelIds: [rawModelId] },
    ],
  });

  assert.equal(
    modelCapabilities.getResolvedModelCapabilities(`${providerId}/${rawModelId}`, undefined, base)
      .structuredOutput,
    false
  );
});

test("recognized free prefix uses its exact base without promoting free-native evidence", () => {
  modelsDevSync.saveModelsDevCapabilities({
    "opencode-go": {
      [crossProviderModelId]: syncedCapability(true),
    },
  });

  assert.equal(
    modelCapabilities.getResolvedModelCapabilities({
      provider: providerId,
      model: `free/${crossProviderModelId}`,
    }).structuredOutput,
    true
  );
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities({
      provider: providerId,
      model: `free/${crossProviderModelId}-preview`,
    }).structuredOutput,
    null
  );

  modelsDevSync.saveModelsDevCapabilities({
    [providerId]: {
      [`free/${crossProviderModelId}`]: syncedCapability(false),
    },
    "opencode-go": {
      [crossProviderModelId]: syncedCapability(true),
    },
  });

  assert.equal(
    modelCapabilities.getResolvedModelCapabilities({
      provider: providerId,
      model: `free/${crossProviderModelId}`,
    }).structuredOutput,
    false
  );
  assert.equal(
    modelCapabilities.getResolvedModelCapabilities({
      provider: providerId,
      model: crossProviderModelId,
    }).structuredOutput,
    true
  );
});
