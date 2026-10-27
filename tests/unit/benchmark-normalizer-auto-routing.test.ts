import test from "node:test";
import assert from "node:assert/strict";
import { createChatPipelineHarness } from "../integration/_chatPipelineHarness.ts";

const harness = await createChatPipelineHarness("benchmark-normalizer-auto-routing");
const {
  BaseExecutor,
  buildOpenAIResponse,
  buildRequest,
  combosDb,
  handleChat,
  resetStorage,
  reasoningRulesDb,
  seedConnection,
  settingsDb,
  toPlainHeaders,
} = harness;
const core = await import("../../src/lib/db/core.ts");
const modelIntelligenceDb = await import("../../src/lib/db/modelIntelligence.ts");
const modelsDevSync = await import("../../src/lib/modelsDevSync.ts");
const modelCapabilities = await import("../../src/lib/modelCapabilities.ts");
const { resolveAutoRoutingState } = await import("../../src/sse/handlers/autoRouting.ts");
const { getDefaultTaskModelMap, resetTaskRoutingStats, setTaskRoutingConfig } =
  await import("../../open-sse/services/taskAwareRouter.ts");

function resetEnv(): void {
  process.env.REQUIRE_API_KEY = "false";
  delete process.env.INPUT_SANITIZER_ENABLED;
  delete process.env.INPUT_SANITIZER_MODE;
  delete process.env.PII_REDACTION_ENABLED;
}

test.beforeEach(async () => {
  BaseExecutor.RETRY_CONFIG.delayMs = 0;
  resetEnv();
  setTaskRoutingConfig({
    enabled: false,
    detectionEnabled: true,
    taskModelMap: getDefaultTaskModelMap(),
  });
  resetTaskRoutingStats();
  await resetStorage();
});

test.afterEach(async () => {
  resetEnv();
  setTaskRoutingConfig({
    enabled: false,
    detectionEnabled: true,
    taskModelMap: getDefaultTaskModelMap(),
  });
  resetTaskRoutingStats();
  await resetStorage();
});

test.after(async () => {
  await harness.cleanup();
});
test("a saved paid combo cannot shadow an explicit free Auto route", async () => {
  const previousBandsFlag = process.env.OMNIROUTE_AUTO_BANDS;
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  try {
    await seedConnection("openai", { apiKey: "sk-openai-free-auto" });
    await seedConnection("claude", { apiKey: "sk-claude-free-auto-fallback" });
    const freeConnection = await seedConnection("openrouter", {
      apiKey: "sk-openrouter-free-auto",
    });
    await settingsDb.updateSettings({
      freeAccessPolicy: "strict",
      modelsDevSyncEnabled: true,
      globalFallbackModel: "claude/claude-sonnet-4.6",
    });
    const bandModels = ["band-collision-model-a:free", "band-collision-model-b:free"];
    const db = core.getDbInstance();
    db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
      "syncedAvailableModels",
      `openrouter:${freeConnection.id}`,
      JSON.stringify(bandModels.map((id) => ({ id, isFree: true })))
    );
    db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
      "models_dev_zero_price",
      "snapshot",
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        modelsByProvider: { openrouter: bandModels },
      })
    );
    modelsDevSync.upsertSyncedCapabilities("openrouter", {
      ...Object.fromEntries(
        bandModels.map((model) => [
          model,
          {
            tool_call: true,
            reasoning: true,
            attachment: null,
            structured_output: true,
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
          },
        ])
      ),
    });
    for (const model of bandModels) {
      modelIntelligenceDb.upsertModelIntelligence({
        model,
        source: "models_dev_tier",
        category: "default",
        score: 0.95,
        eloRaw: null,
        confidence: "high",
        expiresAt: null,
      });
      assert.equal(
        modelCapabilities.getResolvedModelCapabilities({ provider: "openrouter", model })
          .structuredOutput,
        true
      );
    }
    await combosDb.createCombo({
      name: "auto/general_high_so:free",
      strategy: "priority",
      config: { maxRetries: 0, retryDelayMs: 0 },
      models: ["openai/gpt-4.1"],
    });

    const route = await resolveAutoRoutingState("auto/general_high_so:free");
    assert.deepEqual(route.spec, { category: "general_high_so", tier: "free" });
    const attemptedModels: string[] = [];
    globalThis.fetch = async (_url, init) => {
      const headers = toPlainHeaders(init?.headers);
      assert.ok(
        headers["x-api-key"] ?? headers.Authorization ?? headers.authorization,
        "Expected only authenticated provider requests"
      );
      const requestBody = JSON.parse(String(init?.body));
      attemptedModels.push(requestBody.model);
      if (attemptedModels.length === 1) {
        return new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "0" },
        });
      }
      return buildOpenAIResponse("Second in-band model answered");
    };

    const response = await handleChat(
      buildRequest({
        body: {
          model: "auto/general_high_so:free",
          stream: false,
          messages: [{ role: "user", content: "Use only the free Auto route" }],
        },
      })
    );

    assert.equal(response.status, 200);
    assert.ok(
      attemptedModels.length > 0 &&
        attemptedModels.every((model) => bandModels.includes(model)) &&
        new Set(attemptedModels).size === bandModels.length &&
        attemptedModels.every((model) => !["gpt-4.1", "claude-sonnet-4.6"].includes(model)),
      `Expected standard 429 failover inside the free band, got: ${JSON.stringify(attemptedModels)}`
    );
  } finally {
    if (previousBandsFlag === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
    else process.env.OMNIROUTE_AUTO_BANDS = previousBandsFlag;
  }
});

test("a reasoning rule cannot redirect an explicit free Auto route", async () => {
  const previousBandsFlag = process.env.OMNIROUTE_AUTO_BANDS;
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  try {
    await seedConnection("openai", { apiKey: "sk-openai-reasoning-rule-target" });
    await settingsDb.updateSettings({ freeAccessPolicy: "strict" });
    await reasoningRulesDb.createReasoningRoutingRule({
      name: "Redirect explicit free Auto route",
      description: "test that explicit free routing stays in-band",
      scope: "global",
      apiKeyId: null,
      comboId: null,
      connectionId: null,
      modelPattern: "auto/general_high_so:free",
      sourceEffort: "any",
      requestTags: [],
      tagMatchMode: "any",
      effortMode: "inherit",
      targetEffort: null,
      targetKind: "model",
      targetModel: "openai/gpt-4.1",
      targetComboId: null,
      budgetAction: "preserve",
      budgetTokens: null,
      priority: 100,
      enabled: true,
    });

    let providerAttempts = 0;
    globalThis.fetch = async () => {
      providerAttempts += 1;
      return buildOpenAIResponse("must not be called");
    };

    const response = await handleChat(
      buildRequest({
        body: {
          model: "auto/general_high_so:free",
          reasoning_effort: "high",
          stream: false,
          messages: [{ role: "user", content: "Keep the explicit free route" }],
        },
      })
    );
    const json = (await response.json()) as { error: { message: string } };

    assert.equal(response.status, 400);
    assert.match(json.error.message, /explicit free Auto route cannot be rewritten/i);
    assert.equal(providerAttempts, 0);
  } finally {
    if (previousBandsFlag === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
    else process.env.OMNIROUTE_AUTO_BANDS = previousBandsFlag;
  }
});
