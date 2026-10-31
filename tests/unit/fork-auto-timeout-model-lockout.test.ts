import test from "node:test";
import assert from "node:assert/strict";

import type {
  AttemptLoopDeps,
  AttemptLoopState,
} from "../../open-sse/services/combo/attemptLoopTypes.ts";
import type { ResolvedComboTarget } from "../../open-sse/services/combo/types.ts";
import { createChatPipelineHarness } from "../integration/_chatPipelineHarness.ts";

const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const { executeTargetAttempt } =
  await import("../../open-sse/services/combo/executeTargetAttempt.ts");
const virtualFactory = await import("../../open-sse/services/autoCombo/virtualFactory.ts");
const core = await import("../../src/lib/db/core.ts");
const modelIntelligenceDb = await import("../../src/lib/db/modelIntelligence.ts");
const modelsDevSync = await import("../../src/lib/modelsDevSync.ts");
const harness = await createChatPipelineHarness("fork-auto-timeout-model-lockout");
const provider = "openrouter";
const model = "fork-lockout-alpha";
const siblingModel = "fork-lockout-beta";
const modelName = `${provider}/${model}`;
const siblingModelName = `${provider}/${siblingModel}`;
const capability = {
  tool_call: true,
  reasoning: null,
  attachment: null,
  structured_output: null,
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

function emptyState(target: ResolvedComboTarget): AttemptLoopState {
  return {
    orderedTargets: [target],
    fallbackCount: 0,
    recordedAttempts: 0,
    comboErrors: [],
    lastError: null,
    lastStatus: null,
    earliestRetryAfter: null,
    comboExpired: false,
    exhaustedProviders: new Set(),
    exhaustedConnections: new Set(),
    transientRateLimitedProviders: new Set(),
    abortControllers: new Map([[0, new AbortController()]]),
    dispatchedTargets: new Set(),
    targetFailureTrust: new Map(),
    comboAttemptOrder: [],
    skippedForCircuitOpen: false,
    earliestCircuitOpenRetryMs: 0,
    globalAttempts: 0,
    observedFailure: false,
    allObservedFailuresQuota: true,
    observeFailure() {},
  };
}

function baseDeps(overrides: Partial<AttemptLoopDeps> = {}): AttemptLoopDeps {
  return {
    strategy: "priority",
    combo: { name: "lockout-test", models: [] },
    config: {},
    log: { info() {}, warn() {}, debug() {}, error() {} },
    settings: null,
    resilienceSettings: {
      providerCooldown: { enabled: false },
    } as AttemptLoopDeps["resilienceSettings"],
    sticky: { targets: [], messageHash: null, stuck: false },
    effectiveSessionId: null,
    preScreenMap: new Map(),
    quotaCutoffResetWindowConfig: {} as AttemptLoopDeps["quotaCutoffResetWindowConfig"],
    maxRetries: 0,
    traceInvocationId: "fork-lockout-test",
    clientRequestedStream: false,
    handleSingleModelWithTimeout: async () => new Response(null, { status: 504 }),
    body: { messages: [{ role: "user", content: "test" }] },
    startTime: Date.now(),
    releaseStickyPinOnFailure() {},
    clearStaleLKGP() {},
    ...overrides,
  };
}

function seedAvailableModels(connectionId: string): void {
  const db = core.getDbInstance();
  const models = [model, siblingModel];
  db.prepare(
    "INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value"
  ).run(
    "syncedAvailableModels",
    `${provider}:${connectionId}`,
    JSON.stringify(models.map((id) => ({ id, isFree: true })))
  );
  db.prepare(
    "INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value"
  ).run(
    "models_dev_zero_price",
    "snapshot",
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      modelsByProvider: { [provider]: models },
    })
  );
  modelsDevSync.upsertSyncedCapabilities(
    provider,
    Object.fromEntries(models.map((id) => [id, capability]))
  );
  for (const id of models) {
    modelIntelligenceDb.upsertModelIntelligence({
      model: id,
      source: "models_dev_tier",
      category: "coding",
      score: 0.95,
      eloRaw: null,
      confidence: "high",
      expiresAt: null,
    });
  }
}

async function runAttempt(
  connectionId: string,
  response: Response,
  settings: Record<string, unknown> = { modelLockout: { enabled: true } }
): Promise<void> {
  const target: ResolvedComboTarget = {
    kind: "model",
    stepId: "s1",
    executionKey: "lockout-target",
    modelStr: `${provider}/${model}`,
    provider,
    providerId: null,
    connectionId,
    weight: 1,
    label: null,
  };

  await executeTargetAttempt({
    index: 0,
    state: emptyState(target),
    deps: baseDeps({
      settings: settings as AttemptLoopDeps["settings"],
      handleSingleModelWithTimeout: async () => response,
    }),
    targetForAttempt: target,
    profile: {},
    protectedPriorityTarget: false,
  });
}

test.beforeEach(async () => {
  accountFallback.clearAllModelLockouts();
  await harness.resetStorage();
});

test.after(async () => {
  accountFallback.clearAllModelLockouts();
  await harness.cleanup();
});

test("configured native 504 lockout records exact provider, connection, and model tuple", async () => {
  const connectionId = "fork-lockout-default";
  await runAttempt(connectionId, new Response("gateway timeout", { status: 504 }));

  const lockout = accountFallback.getModelLockoutInfo(provider, connectionId, model);
  assert.ok(lockout);
  assert.ok(lockout.remainingMs > 0);
  assert.equal(accountFallback.getModelLockoutInfo(provider, "other-connection", model), null);
  assert.equal(accountFallback.getModelLockoutInfo(provider, connectionId, siblingModel), null);
  assert.equal(accountFallback.getModelLockoutInfo("anthropic", connectionId, model), null);
});

test("explicit modelLockout.enabled=false disables timeout recording", async () => {
  const connectionId = "fork-lockout-disabled";
  await runAttempt(connectionId, new Response("gateway timeout", { status: 504 }), {
    modelLockout: { enabled: false },
  });

  assert.equal(accountFallback.getModelLockoutInfo(provider, connectionId, model), null);
});

test("synthetic combo_target_timeout 504 records exact tuple", async () => {
  const connectionId = "fork-lockout-synthetic-timeout";
  await runAttempt(
    connectionId,
    Response.json(
      { error: { code: "combo_target_timeout", type: "combo_target_timeout" } },
      { status: 504 }
    )
  );

  assert.ok(accountFallback.getModelLockoutInfo(provider, connectionId, model));
});

async function assertNoLockout(name: string, status: number, code: string, type: string) {
  const connectionId = `fork-lockout-${name}`;
  await runAttempt(connectionId, Response.json({ error: { code, type } }, { status }));
  assert.equal(accountFallback.getModelLockoutInfo(provider, connectionId, model), null);
}

test("request validation does not record timeout lockout", async () => {
  await assertNoLockout("validation", 400, "invalid_request_error", "invalid_request_error");
});

test("local queue rejection does not record timeout lockout", async () => {
  await assertNoLockout("queue", 504, "resource_exhausted", "local_queue_capacity");
});

test("client cancel does not record timeout lockout", async () => {
  await assertNoLockout("cancel", 499, "client_disconnected", "request_cancelled");
});

test("real 504 failure filters one account from Auto build, then expiry restores it", async () => {
  const { combosDb, handleChat, buildRequest, seedApiKey, seedConnection, settingsDb } = harness;
  const first = await seedConnection(provider, {
    name: "fork-lockout-first",
    apiKey: "fork-lockout-first",
  });
  const second = await seedConnection(provider, {
    name: "fork-lockout-second",
    apiKey: "fork-lockout-second",
  });
  seedAvailableModels(first.id);
  seedAvailableModels(second.id);
  const apiKey = await seedApiKey({ allowedConnections: [first.id] });
  await settingsDb.updateSettings({
    modelsDevSyncEnabled: true,
    excludeTosAvoid: false,
    modelLockout: { enabled: true },
  });
  const initialPool = await virtualFactory.createVirtualAutoCombo(undefined);
  const initialCandidate = initialPool.models.find((entry) => entry.model === modelName);
  assert.ok(initialCandidate, "locally seeded model appears before failure");
  assert.deepEqual(
    [...(initialCandidate.allowedConnectionIds ?? [])].sort(),
    [first.id, second.id].sort()
  );
  await combosDb.createCombo({
    name: "fork-lockout-request",
    strategy: "priority",
    config: { maxRetries: 0, retryDelayMs: 0, fallbackDelayMs: 0 },
    models: [modelName],
  });
  globalThis.fetch = async () => new Response("gateway timeout", { status: 504 });

  const response = await handleChat(
    buildRequest({
      body: {
        model: "fork-lockout-request",
        stream: false,
        messages: [{ role: "user", content: "record timeout" }],
      },
      authKey: apiKey.key,
    })
  );
  assert.equal(response.status, 504);

  const lockout = accountFallback.getModelLockoutInfo(provider, first.id, model);
  assert.ok(lockout, "real request failure must record lockout");
  const cooledPool = await virtualFactory.createVirtualAutoCombo(undefined);
  const cooled = cooledPool.models.find((entry) => entry.model === modelName);
  assert.ok(cooled, "sibling account keeps logical model candidate");
  assert.deepEqual(cooled.allowedConnectionIds, [second.id]);
  const sibling = cooledPool.models.find((entry) => entry.model === siblingModelName);
  assert.ok(sibling, "sibling model stays eligible");
  assert.deepEqual([...(sibling.allowedConnectionIds ?? [])].sort(), [first.id, second.id].sort());

  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + lockout.remainingMs + 1;
    assert.equal(accountFallback.isModelLocked(provider, first.id, model), false);
    const restoredPool = await virtualFactory.createVirtualAutoCombo(undefined);
    const restored = restoredPool.models.find((entry) => entry.model === modelName);
    assert.ok(restored);
    assert.deepEqual([...restored.allowedConnectionIds].sort(), [first.id, second.id].sort());
  } finally {
    Date.now = originalNow;
  }
});
