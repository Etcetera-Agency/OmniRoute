import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFmoHeadInventory } from "../../src/lib/fmoPools/inventory.ts";
import { solveFmoPools, type FmoSolveCandidate } from "../../src/lib/fmoPools/packing.ts";
import { buildFmoTail } from "../../src/lib/fmoPools/tail.ts";
import { readFmoTailConfig, readFmoTailProviderConfig } from "../../src/lib/fmoPools/tailConfig.ts";
import type { FmoPlanningPool } from "../../src/lib/fmoPools/types.ts";

const ORIGINAL_TAIL_CONFIG_PATH = process.env.OMNIROUTE_FMO_TAIL_CONFIG_PATH;

test.afterEach(() => {
  if (ORIGINAL_TAIL_CONFIG_PATH === undefined) delete process.env.OMNIROUTE_FMO_TAIL_CONFIG_PATH;
  else process.env.OMNIROUTE_FMO_TAIL_CONFIG_PATH = ORIGINAL_TAIL_CONFIG_PATH;
});

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
      free_only: false,
    },
    tail: { strategy: "configured", mode: "fallback", compatibility: "capability-and-context" },
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
      candidate({
        providerId: "overflow",
        modelId: "premium",
        capabilities: ["chat", "tools"],
        qualityScore: 0.7,
        score: 0.99,
      }),
      candidate({ providerId: "relaxed", modelId: "near", qualityScore: 0.52, score: 0.5 }),
    ]
  );

  assert.equal(result.plans["combo-coding"][0].providerId, "relaxed");
  assert.equal(result.decisions[0].reason, "relaxed-band");
});

test("higher-capability overflow is keyed by capability surplus, not score", () => {
  const result = solveFmoPools(
    [pool("coding", "combo-coding", ["chat"], 100)],
    [
      candidate({
        providerId: "high-score",
        modelId: "plain",
        capabilities: ["chat"],
        qualityScore: 0.95,
        score: 0.99,
      }),
      candidate({
        providerId: "surplus",
        modelId: "tool",
        capabilities: ["chat", "tools"],
        qualityScore: 0.7,
        score: 0.5,
      }),
    ]
  );

  assert.deepEqual(
    result.plans["combo-coding"].map((member) => member.providerId),
    ["surplus"]
  );
  assert.equal(result.decisions[0].reason, "overflow");
});

test("stricter pool is covered before capability surplus overflow is spent", () => {
  const result = solveFmoPools(
    [pool("text", "combo-text", ["chat"]), pool("tools", "combo-tools", ["chat", "tools"])],
    [
      candidate({
        providerId: "rare-best",
        modelId: "tool-a",
        capabilities: ["chat", "tools"],
        score: 0.9,
      }),
      candidate({
        providerId: "rare-overflow",
        modelId: "tool-b",
        capabilities: ["chat", "tools"],
        score: 0.8,
      }),
    ]
  );

  assert.equal(result.plans["combo-tools"][0].providerId, "rare-best");
  assert.equal(result.plans["combo-text"][0].providerId, "rare-overflow");
  assert.equal(
    result.decisions.find((decision) => decision.comboId === "combo-text")?.reason,
    "overflow"
  );
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

test("within-margin challenger keeps incumbent and records kept outcome", () => {
  const result = solveFmoPools(
    [pool("coding", "combo-coding", ["chat"], 100)],
    [
      candidate({ providerId: "inc", modelId: "old", connectionId: "acct-old", score: 0.8 }),
      candidate({
        providerId: "new",
        modelId: "challenger",
        connectionId: "acct-new",
        score: 0.85,
      }),
    ],
    {
      prior: {
        byComboId: {
          "combo-coding": [{ providerId: "inc", modelId: "old", connectionId: "acct-old" }],
        },
      },
    }
  );
  const kept = result.decisions.find((decision) => decision.outcome === "kept");

  assert.equal(result.plans["combo-coding"][0].providerId, "inc");
  assert.equal(kept?.providerId, "inc");
  assert.match(kept?.reason ?? "", /challenger=new:challenger:acct-new/);
  assert.match(kept?.reason ?? "", /delta=0\.05/);
});

test("margin-beating challenger displaces incumbent and records displaced outcome", () => {
  const result = solveFmoPools(
    [pool("coding", "combo-coding", ["chat"], 100)],
    [
      candidate({ providerId: "inc", modelId: "old", connectionId: "acct-old", score: 0.7 }),
      candidate({
        providerId: "new",
        modelId: "challenger",
        connectionId: "acct-new",
        score: 0.9,
      }),
    ],
    {
      prior: {
        byComboId: {
          "combo-coding": [{ providerId: "inc", modelId: "old", connectionId: "acct-old" }],
        },
      },
    }
  );
  const displaced = result.decisions.find((decision) => decision.outcome === "displaced");

  assert.equal(result.plans["combo-coding"][0].providerId, "new");
  assert.equal(displaced?.providerId, "inc");
  assert.match(displaced?.reason ?? "", /challenger=new:challenger:acct-new/);
  assert.match(displaced?.reason ?? "", /delta=0\.20/);
});

test("eligible prior pin is retained as hard stickiness before filling new accounts", () => {
  const result = solveFmoPools(
    [pool("coding", "combo-coding", ["chat"], 200)],
    [
      candidate({
        providerId: "inc",
        modelId: "old",
        connectionId: "acct-old",
        capacityPerDay: 100,
        score: 0.8,
      }),
      candidate({
        providerId: "new",
        modelId: "challenger",
        connectionId: "acct-new",
        capacityPerDay: 100,
        score: 0.85,
      }),
    ],
    {
      prior: {
        byComboId: {
          "combo-coding": [{ providerId: "inc", modelId: "old", connectionId: "acct-old" }],
        },
      },
    }
  );

  assert.deepEqual(
    result.plans["combo-coding"].map((member) => member.connectionId),
    ["acct-old", "acct-new"]
  );
  assert.ok(result.decisions.some((decision) => decision.outcome === "kept"));
});

test("mixed pinned and unpinned head entries for one provider fail closed", () => {
  const warnings: string[] = [];

  assert.throws(
    () =>
      solveFmoPools(
        [pool("a", "combo-a", ["chat"], 100), pool("b", "combo-b", ["chat"], 100)],
        [
          candidate({ providerId: "mixed", modelId: "pinned", connectionId: "acct-1" }),
          candidate({ providerId: "mixed", modelId: "unpinned", connectionId: null }),
        ],
        { logger: { warn: (message) => warnings.push(message) } }
      ),
    /mixed pinned and unpinned/
  );
  assert.equal(warnings[0], "FMO plan mixes pinned and unpinned head entries for provider");
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

test("real tail config source appends matching entries and excludes the same provider from head", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-fmo-tail-config-"));
  const configPath = path.join(dir, "tail.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      providers: ["tail-provider"],
      entries: [
        {
          providerId: "tail-provider",
          modelId: "tail-model",
          capabilities: ["chat", "tools"],
          contextWindow: 128_000,
        },
      ],
    })
  );
  process.env.OMNIROUTE_FMO_TAIL_CONFIG_PATH = configPath;

  const tail = readFmoTailConfig();
  const members = buildFmoTail(pool("tools", "combo-tools", ["tools"]), tail, new Set());
  const head = await buildFmoHeadInventory({
    async getProviderConnections() {
      return [
        { id: "acct-head", provider: "head-provider" },
        { id: "acct-tail", provider: "tail-provider" },
      ];
    },
    async getSyncedAvailableModelsForConnection(providerId, connectionId) {
      return [
        {
          id: `${providerId}-model`,
          name: `${providerId} ${connectionId}`,
          source: "imported",
          supportedEndpoints: ["chat"],
          inputTokenLimit: 128_000,
        },
      ];
    },
    getModelCompatOverrides() {
      return [];
    },
    freeModelCatalog: [],
    readTailConfig: readFmoTailProviderConfig,
  });

  assert.deepEqual(members, [
    {
      role: "tail",
      providerId: "tail-provider",
      modelId: "tail-model",
      connectionId: null,
      countedCapacity: 0,
    },
  ]);
  assert.deepEqual(
    head.map((row) => row.providerId),
    ["head-provider"]
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("malformed real tail config logs and degrades to empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-fmo-tail-config-bad-"));
  const configPath = path.join(dir, "tail.json");
  const warnings: Array<Record<string, unknown> | undefined> = [];
  fs.writeFileSync(configPath, JSON.stringify({ providers: ["tail-provider"], entries: "bad" }));
  process.env.OMNIROUTE_FMO_TAIL_CONFIG_PATH = configPath;

  assert.deepEqual(readFmoTailConfig({ warn: (_message, context) => warnings.push(context) }), {
    entries: [],
  });
  assert.deepEqual(readFmoTailProviderConfig(), { providers: [] });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.configPath, configPath);
  fs.rmSync(dir, { recursive: true, force: true });
});
