import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-compatible-capability-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const modelCapabilities = await import("../../src/lib/modelCapabilities.ts");

const providerId = "openai-compatible-local";
const rawModelId = "gpt-4o";

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
