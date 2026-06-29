import test from "node:test";
import assert from "node:assert/strict";
import { solveFmoPools, type FmoSolveCandidate } from "../../src/lib/fmoPools/packing.ts";
import { buildFmoTail } from "../../src/lib/fmoPools/tail.ts";
import type { FmoPlanningPool } from "../../src/lib/fmoPools/types.ts";

function pool(
  id: string,
  comboId: string,
  requiredCapabilities: string[],
  demand = 100,
  minContext = 32_000
): FmoPlanningPool {
  return {
    pool_id: id,
    combo_id: comboId,
    demand: { requests_per_day: demand },
    constraints: {
      min_context_tokens: minContext,
      quality_band: { category: "coding", min: 0.6, max: 0.8, relax: 0.15 },
      required_capabilities: requiredCapabilities,
      hard_gates: [],
    },
    tail: [],
  };
}

function candidate(overrides: Partial<FmoSolveCandidate>): FmoSolveCandidate {
  return {
    providerId: "p",
    connectionId: "acct",
    modelId: "model",
    capabilities: ["chat"],
    contextWindow: 64_000,
    qualityScore: 0.7,
    quotaTier: 1,
    capacityPerDay: 100,
    score: 1,
    ...overrides,
  };
}

test("rare exact-fit candidate is reserved for stricter pool", () => {
  const result = solveFmoPools(
    [pool("text", "combo-text", ["chat"]), pool("tools", "combo-tools", ["chat", "tools"])],
    [
      candidate({
        providerId: "rare",
        modelId: "tool",
        capabilities: ["chat", "tools"],
        score: 0.9,
      }),
      candidate({ providerId: "text", modelId: "plain", capabilities: ["chat"], score: 0.8 }),
    ]
  );

  assert.equal(result.plans["combo-tools"][0].providerId, "rare");
  assert.equal(result.plans["combo-text"][0].providerId, "text");
});

test("relaxed band is used before higher-capability overflow", () => {
  const result = solveFmoPools(
    [pool("coding", "combo-coding", ["chat"], 100)],
    [
      candidate({ providerId: "overflow", modelId: "premium", qualityScore: 0.95, score: 0.99 }),
      candidate({ providerId: "relaxed", modelId: "near", qualityScore: 0.52, score: 0.5 }),
    ]
  );

  assert.equal(result.plans["combo-coding"][0].providerId, "relaxed");
  assert.equal(result.decisions[0].reason, "relaxed-band");
});

test("hard capability and context gates are never relaxed", () => {
  const result = solveFmoPools(
    [pool("tools", "combo-tools", ["tools"], 100, 100_000)],
    [
      candidate({
        providerId: "text",
        modelId: "plain",
        capabilities: ["chat"],
        contextWindow: 200_000,
      }),
      candidate({
        providerId: "small",
        modelId: "tiny",
        capabilities: ["tools"],
        contextWindow: 8_000,
      }),
    ]
  );

  assert.deepEqual(result.plans["combo-tools"], []);
});

test("quota-learning canary is seated first and not counted", () => {
  const result = solveFmoPools(
    [pool("coding", "combo-coding", ["chat"], 100)],
    [
      candidate({
        providerId: "canary",
        modelId: "unknown",
        quotaTier: 4,
        capacityPerDay: null,
        score: 0.7,
      }),
      candidate({
        providerId: "known",
        modelId: "known",
        quotaTier: 1,
        capacityPerDay: 100,
        score: 0.6,
      }),
    ]
  );

  assert.equal(result.plans["combo-coding"][0].role, "canary");
  assert.equal(result.plans["combo-coding"][0].countedCapacity, 0);
  assert.equal(result.plans["combo-coding"][1].providerId, "known");
});

test("incumbent receives stability margin and degraded incumbent is dropped", () => {
  const result = solveFmoPools(
    [pool("coding", "combo-coding", ["chat"], 100)],
    [
      candidate({ providerId: "inc", modelId: "old", connectionId: "acct-old", score: 0.81 }),
      candidate({
        providerId: "new",
        modelId: "challenger",
        connectionId: "acct-new",
        score: 0.85,
      }),
      candidate({
        providerId: "bad",
        modelId: "degraded",
        connectionId: "acct-bad",
        degraded: true,
      }),
    ],
    {
      prior: {
        byComboId: {
          "combo-coding": [
            { providerId: "inc", modelId: "old", connectionId: "acct-old" },
            { providerId: "bad", modelId: "degraded", connectionId: "acct-bad" },
          ],
        },
      },
    }
  );

  assert.equal(result.plans["combo-coding"][0].providerId, "inc");
  assert.ok(result.decisions.some((decision) => decision.outcome === "dropped"));
});

test("tail is unpinned, uncounted, capability-filtered, and guarded against head-pinned providers", () => {
  const warnings: Array<Record<string, unknown> | undefined> = [];
  const members = buildFmoTail(
    pool("tools", "combo-tools", ["tools"], 100, 32_000),
    {
      entries: [
        {
          providerId: "tail-tools",
          modelId: "tool",
          capabilities: ["tools"],
          contextWindow: 64_000,
        },
        { providerId: "tail-text", modelId: "text", capabilities: ["chat"], contextWindow: 64_000 },
        {
          providerId: "head-provider",
          modelId: "bad",
          capabilities: ["tools"],
          contextWindow: 64_000,
        },
      ],
    },
    new Set(["head-provider"]),
    { warn: (_message, context) => warnings.push(context) }
  );

  assert.deepEqual(members, [
    {
      role: "tail",
      providerId: "tail-tools",
      modelId: "tool",
      connectionId: null,
      countedCapacity: 0,
    },
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.providerId, "head-provider");
});
