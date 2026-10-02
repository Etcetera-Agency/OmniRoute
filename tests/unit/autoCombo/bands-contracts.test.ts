import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, it, vi } from "vitest";
import type { ComboForecastUsageRow } from "../../../src/lib/db/comboForecast";
import type { QuotaSnapshotRow } from "../../../src/shared/types/utilization";

const mockFactory = vi.hoisted(() => vi.fn(async () => ({ candidatePool: [] as string[] })));
const mockGetCandidates = vi.hoisted(() =>
  vi.fn(async (channel: string) => ({ channel, candidates: [] as unknown[] }))
);

vi.mock("../../../src/sse/services/model", () => ({
  getComboForModel: async () => null,
  getModelInfo: async () => ({ provider: null, model: null }),
}));

vi.mock("@/lib/reasoningRouting/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reasoningRouting/policy")>();
  return {
    ...actual,
    resolveReasoningRoutingRule: async () => null,
  };
});

vi.mock("@omniroute/open-sse/services/autoCombo/virtualFactory.ts", () => ({
  createVirtualAutoCombo: mockFactory,
}));

vi.mock("@/app/api/v1/_helpers/apiKeyScope", () => ({
  getApiKeyRequestScope: async () => ({
    apiKey: "valid-test-key",
    apiKeyId: "test-key-id",
    isSessionAuth: false,
    rejection: null,
  }),
}));

vi.mock("@omniroute/open-sse/handlers/autoComboCandidates.ts", () => ({
  getAutoComboCandidates: mockGetCandidates,
  isUnknownAutoChannelError: () => false,
}));

const previousDataDir = process.env.DATA_DIR;
const previousBandsFlag = process.env.OMNIROUTE_AUTO_BANDS;
const testDataDir = mkdtempSync(path.join(tmpdir(), "omniroute-auto-bands-contracts-"));
process.env.DATA_DIR = testDataDir;

const [
  { applyReasoningRouting },
  { createVirtualAutoCombo, resolveAutoRoutingState },
  { getTaskFitnessWithSource },
  core,
] = await Promise.all([
  import("../../../src/sse/handlers/reasoningRouting"),
  import("../../../src/sse/handlers/autoRouting"),
  import("../../../open-sse/services/autoCombo/taskFitness"),
  import("../../../src/lib/db/core"),
]);
const { GET: getCandidatesRoute } =
  await import("../../../src/app/api/v1/auto-combo/[channel]/candidates/route");

afterAll(() => {
  core.resetDbInstance();
  rmSync(testDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
});

afterEach(() => {
  if (previousBandsFlag === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = previousBandsFlag;
});

describe("auto quality band upstream contracts", () => {
  it.each(["auto/coding_high", "auto/coding_high:free"])(
    "reasoning routing passes %s through unchanged when no rule matches",
    async (requestedId) => {
      const body = { model: requestedId, messages: [] };
      const result = await applyReasoningRouting({
        request: new Request("https://example.test/v1/chat/completions", { method: "POST" }),
        body,
        modelStr: requestedId,
        policy: { apiKey: null, apiKeyInfo: null },
        apiKeyInfo: null,
      });

      assert.equal(result.response, null);
      assert.equal(result.reasoningDecision, null);
      assert.equal(result.modelStr, requestedId);
      assert.equal(result.reasoningIntent.model, requestedId);
      assert.equal(result.body, body);
    }
  );

  it("preserves the full requested channel as the virtual combo identity", async () => {
    const requestedId = "auto/general_mid:free";
    const virtualCombo = await createVirtualAutoCombo(
      {
        model: requestedId,
        spec: { category: "general_mid" as never, tier: "free" },
        isAutoRouting: true,
        recognizedBuiltInAuto: true,
        response: null,
      },
      null
    );

    assert.equal(virtualCombo.name, requestedId);
    assert.equal(virtualCombo.id, requestedId);
  });

  it.each(["auto/coding_high", "auto/coding_high:free"])(
    "resolves %s without changing its requested channel identity",
    async (requestedId) => {
      process.env.OMNIROUTE_AUTO_BANDS = "1";
      const state = await resolveAutoRoutingState(requestedId);

      assert.equal(state.model, requestedId);
      assert.equal(state.spec?.category, "coding_high");
      assert.equal(state.spec?.tier, requestedId.endsWith(":free") ? "free" : "thrifty");
    }
  );

  it("uses a fresh degraded state on the next request after the kill switch is disabled", async () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    const enabledState = await resolveAutoRoutingState("auto/general_mid");
    assert.equal(enabledState.spec?.category, "general_mid");
    assert.equal(enabledState.spec?.tier, "thrifty");

    process.env.OMNIROUTE_AUTO_BANDS = "0";
    const disabledState = await resolveAutoRoutingState("auto/general_mid");
    assert.equal(disabledState.model, "auto/general_mid");
    assert.equal(disabledState.spec?.category, "chat");
    assert.equal(disabledState.spec?.tier, undefined);
  });

  it("passes an opaque category through the prepared virtual factory contract", async () => {
    const factory = await vi.importActual<
      typeof import("@omniroute/open-sse/services/autoCombo/virtualFactory.ts")
    >("@omniroute/open-sse/services/autoCombo/virtualFactory.ts");
    const virtualCombo = await factory.createVirtualAutoComboFromPrepared(
      { regularCandidates: [], familyCandidates: [] },
      undefined,
      { category: "general_mid" as never }
    );

    assert.deepEqual(virtualCombo.candidatePool, []);
  });

  it("keeps the upstream task-fitness score and source contract", () => {
    const fitness = getTaskFitnessWithSource("omniroute-band-contract-unknown-coder", "coding");

    assert.equal(typeof fitness.score, "number");
    assert.ok(fitness.source.startsWith("wildcard_boost"), fitness.source);
  });

  it("keeps the forecast and quota row field contracts", () => {
    const usage: ComboForecastUsageRow = {
      comboName: "auto/general_mid:free",
      executionKey: null,
      stepId: null,
      provider: "opencode",
      model: "big-pickle",
      requestedModel: "auto/general_mid:free",
      connectionId: null,
      requests: 1,
      successCount: 1,
      inputTokens: 12,
      outputTokens: 34,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
      totalTokens: 46,
      avgLatencyMs: 10,
      lastUsedAt: null,
    };
    const quota: QuotaSnapshotRow = {
      id: 1,
      provider: "opencode",
      connection_id: "noauth",
      window_key: "daily",
      remaining_percentage: 100,
      is_exhausted: 0,
      next_reset_at: null,
      window_duration_ms: null,
      raw_data: null,
      created_at: "2026-10-03T00:00:00.000Z",
    };

    assert.equal(usage.comboName, "auto/general_mid:free");
    assert.equal(quota.window_key, "daily");
  });

  it("accepts a band channel in the candidates route with a valid API key", async () => {
    const response = await getCandidatesRoute(
      new Request("http://localhost/api/v1/auto-combo/general_mid:free/candidates"),
      { params: Promise.resolve({ channel: "general_mid:free" }) }
    );

    assert.equal(response.status, 200);
    assert.equal(mockGetCandidates.mock.calls.at(-1)?.[0], "general_mid:free");
  });
});
