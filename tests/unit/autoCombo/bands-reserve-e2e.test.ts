import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const reserveFixtures = vi.hoisted(() => ({
  usageRows: [] as Array<Record<string, unknown>>,
  quotaRows: [] as Array<Record<string, unknown>>,
  catalogEntries: [] as Array<Record<string, unknown>>,
  usageReads: 0,
  quotaReads: 0,
  catalogReads: 0,
  failUsageReads: false,
}));

vi.mock("@/lib/db/comboForecast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/comboForecast")>();
  return {
    ...actual,
    getComboForecastUsageRows: () => {
      reserveFixtures.usageReads += 1;
      if (reserveFixtures.failUsageReads) throw new Error("test usage read failure");
      return reserveFixtures.usageRows;
    },
  };
});

vi.mock("@/lib/db/quotaSnapshots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/quotaSnapshots")>();
  return {
    ...actual,
    getQuotaSnapshots: () => {
      reserveFixtures.quotaReads += 1;
      return reserveFixtures.quotaRows;
    },
  };
});

vi.mock("@/lib/radar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/radar")>();
  return {
    ...actual,
    getRadarCatalog: () => {
      reserveFixtures.catalogReads += 1;
      return { entries: reserveFixtures.catalogEntries, meta: null };
    },
  };
});

const originalEnv = {
  dataDir: process.env.DATA_DIR,
  bands: process.env.OMNIROUTE_AUTO_BANDS,
  config: process.env.OMNIROUTE_AUTO_BANDS_CONFIG,
  fullPoolFallback: process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL,
};
const temporaryDirectories: string[] = [];
let resetDbInstance = () => {};

const MODEL = "band-reserve-e2e-model";
const PROVIDER = "openrouter";
const ACCOUNT_A = "reserve-account-a";
const ACCOUNT_B = "reserve-account-b";

function usageRow(connectionId: string) {
  return {
    comboName: "ordinary-combo",
    executionKey: null,
    stepId: null,
    provider: PROVIDER,
    model: MODEL,
    requestedModel: null,
    connectionId,
    requests: 1,
    successCount: 1,
    inputTokens: 6_000,
    outputTokens: 4_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 10_000,
    avgLatencyMs: 0,
    lastUsedAt: null,
  };
}

function catalogEntry() {
  return {
    provider: PROVIDER,
    modelId: MODEL,
    displayName: MODEL,
    monthlyTokens: 10_000,
    creditTokens: 0,
    freeType: "recurring-monthly",
    poolKey: null,
    tos: "ok",
    origin: "baseline",
    enabled: true,
  };
}

function makePreparedCandidate(
  connectionId = ACCOUNT_A,
  allowedConnectionIds = [ACCOUNT_A, ACCOUNT_B]
) {
  return {
    provider: PROVIDER,
    model: MODEL,
    modelStr: `${PROVIDER}/${MODEL}`,
    connectionId,
    allowedConnectionIds,
    costPer1MTokens: 0,
  };
}

function makeConfigPath(reserve: Record<string, unknown>): string {
  const directory = mkdtempSync(path.join(tmpdir(), "omniroute-bands-reserve-e2e-"));
  temporaryDirectories.push(directory);
  const configPath = path.join(directory, "bands.json");
  writeFileSync(configPath, JSON.stringify({ reserve }));
  return configPath;
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function loadHarness(options: {
  reserveEnabled?: boolean;
  bandsEnabled?: boolean;
  now?: Date;
  maxAgeMinutes?: number;
  fullPoolFallback?: boolean;
  rows?: Array<Record<string, unknown>>;
}) {
  vi.resetModules();
  reserveFixtures.usageRows = options.rows ?? [usageRow(ACCOUNT_A)];
  reserveFixtures.quotaRows = [];
  reserveFixtures.catalogEntries = [catalogEntry()];
  reserveFixtures.usageReads = 0;
  reserveFixtures.quotaReads = 0;
  reserveFixtures.catalogReads = 0;
  reserveFixtures.failUsageReads = false;

  const dataDir = mkdtempSync(path.join(tmpdir(), "omniroute-bands-reserve-data-"));
  temporaryDirectories.push(dataDir);
  process.env.DATA_DIR = dataDir;
  process.env.OMNIROUTE_AUTO_BANDS = options.bandsEnabled === false ? "0" : "1";
  process.env.OMNIROUTE_AUTO_BANDS_CONFIG = makeConfigPath({
    enabled: options.reserveEnabled !== false,
    lookbackDays: 7,
    refreshMinutes: 10,
    maxAgeMinutes: options.maxAgeMinutes ?? 60,
    maxSnapshotAgeMinutes: 30,
    floorPct: 10,
    staticReservePct: { mid: 0, high: 0 },
    axes: { live: false, daily: false, monthly: true },
  });
  if (options.fullPoolFallback) {
    process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL = "1";
  } else {
    delete process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL;
  }

  const [factory, resolver, taskFitness, config, db] = await Promise.all([
    import("../../../open-sse/services/autoCombo/virtualFactory"),
    import("../../../open-sse/services/combo/resolveAutoStrategy"),
    import("../../../open-sse/services/autoCombo/taskFitness"),
    import("../../../open-sse/services/autoCombo/bands/config"),
    import("../../../src/lib/db/core"),
  ]);
  resetDbInstance = db.resetDbInstance;
  await waitFor(() =>
    expect(config.getBandConfig().reserve.enabled).toBe(options.reserveEnabled !== false)
  );
  taskFitness.setUserFitnessOverride(MODEL, "default", 0.5);

  return { factory, resolver, taskFitness, config };
}

async function createLowThriftyCombo(
  factory: Awaited<ReturnType<typeof loadHarness>>["factory"],
  candidate = makePreparedCandidate()
) {
  return factory.createVirtualAutoComboFromPrepared(
    {
      regularCandidates: [candidate],
      familyCandidates: [],
      authTypeByConnectionId: new Map([
        [ACCOUNT_A, "api_key"],
        [ACCOUNT_B, "api_key"],
      ]),
    },
    undefined,
    { category: "general_low" as never, tier: "thrifty" }
  );
}

function makeResolvedTarget(
  model: Awaited<ReturnType<typeof createLowThriftyCombo>>["models"][number]
) {
  const stepId = `step-${model.providerId}-${model.model}`;
  return {
    kind: "model" as const,
    stepId,
    executionKey: `${stepId}@${model.connectionId ?? "logical"}`,
    modelStr: model.model,
    provider: model.providerId,
    providerId: model.providerId,
    connectionId: model.connectionId,
    allowedConnectionIds: model.allowedConnectionIds ?? [],
    weight: model.weight,
    label: model.label,
  };
}

function makeAutoCandidate(target: ReturnType<typeof makeResolvedTarget>, connectionId: string) {
  return {
    kind: "model" as const,
    stepId: target.stepId,
    executionKey: `${target.executionKey}@${connectionId}`,
    modelStr: target.modelStr,
    provider: target.provider,
    model: MODEL,
    connectionId,
    quotaRemaining: 100,
    quotaTotal: 100,
    circuitBreakerState: "CLOSED" as const,
    costPer1MTokens: 0,
    p95LatencyMs: 100,
    latencyStdDev: 1,
    errorRate: 0,
    quality: 0.5,
    quotaCutoffBlocked: false,
  };
}

async function resolveActualFanout(
  resolver: Awaited<ReturnType<typeof loadHarness>>["resolver"],
  combo: Awaited<ReturnType<typeof createLowThriftyCombo>>
) {
  const targets = combo.models.map(makeResolvedTarget);
  return resolver.resolveAutoStrategyOrder({
    orderedTargets: targets as never,
    body: { messages: [] },
    combo: {
      name: "Auto band reserve e2e",
      models: combo.models,
      config: combo.config,
      autoConfig: combo.autoConfig,
    } as never,
    settings: null,
    config: {},
    relayOptions: null,
    resilienceSettings: { quotaPreflight: { enabled: false } } as never,
    log: { info() {}, warn() {}, error() {}, debug() {} } as never,
    buildAutoCandidates: async (candidateTargets) =>
      (candidateTargets as typeof targets).flatMap((target) =>
        target.allowedConnectionIds.map((connectionId) => makeAutoCandidate(target, connectionId))
      ) as never,
  } as never);
}

afterEach(() => {
  resetDbInstance();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  if (originalEnv.dataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalEnv.dataDir;
  if (originalEnv.bands === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = originalEnv.bands;
  if (originalEnv.config === undefined) delete process.env.OMNIROUTE_AUTO_BANDS_CONFIG;
  else process.env.OMNIROUTE_AUTO_BANDS_CONFIG = originalEnv.config;
  if (originalEnv.fullPoolFallback === undefined) {
    delete process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL;
  } else {
    process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL = originalEnv.fullPoolFallback;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("auto quality band capacity-reserve integration", () => {
  it("keeps the cold pool, then narrows a stale direct pin to B before marker and fanout", async () => {
    const { factory, resolver } = await loadHarness({});

    const coldCombo = await createLowThriftyCombo(factory);
    expect(coldCombo.models[0]?.allowedConnectionIds).toEqual([ACCOUNT_A, ACCOUNT_B]);
    expect(coldCombo.models[0]?.connectionId).toBe(ACCOUNT_A);
    expect(reserveFixtures.usageReads).toBe(0);

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reserveFixtures.usageReads).toBeGreaterThan(0);

    const combo = await createLowThriftyCombo(factory);
    expect(combo.models[0]?.allowedConnectionIds).toEqual([ACCOUNT_B]);
    expect(combo.models[0]?.connectionId).toBeNull();
    expect(
      combo.autoConfig.bandBillingPriority?.assignments.map(({ connectionId }) => connectionId)
    ).toEqual([ACCOUNT_B]);

    const result = await resolveActualFanout(resolver, combo);
    expect("orderedTargets" in result).toBe(true);
    if ("orderedTargets" in result) {
      expect(result.orderedTargets.map(({ connectionId }) => connectionId)).toEqual([ACCOUNT_B]);
    }
  }, 30_000);

  it("drops a candidate after every account is reserved without re-admitting the full pool", async () => {
    const { factory } = await loadHarness({
      rows: [usageRow(ACCOUNT_A), usageRow(ACCOUNT_B)],
      fullPoolFallback: true,
    });

    await createLowThriftyCombo(factory);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const combo = await createLowThriftyCombo(factory);
    expect(combo.models).toEqual([]);
    expect(combo.autoConfig.bandBillingPriority?.assignments).toEqual([]);
  }, 30_000);

  it("leaves candidates unchanged before a snapshot, after stale data, and after refresh failure", async () => {
    const { factory } = await loadHarness({ maxAgeMinutes: 1 });

    const coldCombo = await createLowThriftyCombo(factory);
    expect(coldCombo.models[0]?.allowedConnectionIds).toEqual([ACCOUNT_A, ACCOUNT_B]);

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reserveFixtures.usageReads).toBeGreaterThan(0);
    const freshCombo = await createLowThriftyCombo(factory);
    expect(freshCombo.models[0]?.allowedConnectionIds).toEqual([ACCOUNT_B]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 2 * 60_000));
    reserveFixtures.failUsageReads = true;
    const staleCombo = await createLowThriftyCombo(factory);
    expect(staleCombo.models[0]?.allowedConnectionIds).toEqual([ACCOUNT_A, ACCOUNT_B]);
    await vi.advanceTimersByTimeAsync(0);
    const failedRefreshCombo = await createLowThriftyCombo(factory);
    expect(failedRefreshCombo.models[0]?.allowedConnectionIds).toEqual([ACCOUNT_A, ACCOUNT_B]);
  }, 30_000);

  it("does not read or narrow reserves when bands or reserve are disabled, or for high", async () => {
    const highHarness = await loadHarness({ reserveEnabled: true });
    highHarness.taskFitness.setUserFitnessOverride(MODEL, "default", 0.9);
    const high = await createVirtualWithCategory(highHarness.factory, "general_high");
    expect(high.models[0]?.allowedConnectionIds).toEqual([ACCOUNT_A, ACCOUNT_B]);
    expect(
      reserveFixtures.usageReads + reserveFixtures.quotaReads + reserveFixtures.catalogReads
    ).toBe(0);

    const disabled = await loadHarness({ reserveEnabled: false });
    const disabledCombo = await createLowThriftyCombo(
      disabled.factory,
      makePreparedCandidate(ACCOUNT_A, [ACCOUNT_B])
    );
    expect(disabledCombo.models[0]?.allowedConnectionIds).toEqual([ACCOUNT_B]);
    expect(disabledCombo.models[0]?.connectionId).toBeNull();
    expect(
      disabledCombo.autoConfig.bandBillingPriority?.assignments.map(
        ({ connectionId }) => connectionId
      )
    ).toEqual([ACCOUNT_B]);
    expect(
      reserveFixtures.usageReads + reserveFixtures.quotaReads + reserveFixtures.catalogReads
    ).toBe(0);

    const off = await loadHarness({ bandsEnabled: false });
    const offCombo = await createLowThriftyCombo(off.factory);
    expect(offCombo.models[0]?.allowedConnectionIds).toEqual([ACCOUNT_A, ACCOUNT_B]);
    expect(offCombo.models[0]?.connectionId).toBe(ACCOUNT_A);
    expect(offCombo.autoConfig.bandBillingPriority).toBeUndefined();
    expect(
      reserveFixtures.usageReads + reserveFixtures.quotaReads + reserveFixtures.catalogReads
    ).toBe(0);
  }, 30_000);
});

async function createVirtualWithCategory(
  factory: Awaited<ReturnType<typeof loadHarness>>["factory"],
  category: string
) {
  return factory.createVirtualAutoComboFromPrepared(
    {
      regularCandidates: [makePreparedCandidate()],
      familyCandidates: [],
      authTypeByConnectionId: new Map([
        [ACCOUNT_A, "api_key"],
        [ACCOUNT_B, "api_key"],
      ]),
    },
    undefined,
    { category: category as never, tier: "thrifty" }
  );
}
