import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComboForecastUsageRow } from "../../../src/lib/db/comboForecast";
import type { MergedEntry } from "../../../src/lib/radar/applyFeed";
import { capacityScopeKey } from "../../../open-sse/services/autoCombo/bands/capacity";
import {
  createReserveController,
  evaluateReserveScope,
  type DemandMetricsByBand,
  type ReserveRefreshEvent,
  type ScopedReserveDemand,
} from "../../../open-sse/services/autoCombo/bands/reserve";

const DAY_MS = 24 * 60 * 60_000;
const originalBandsFlag = process.env.OMNIROUTE_AUTO_BANDS;

function settings() {
  return {
    enabled: true,
    lookbackDays: 7,
    refreshMinutes: 10,
    maxAgeMinutes: 60,
    maxSnapshotAgeMinutes: 30,
    floorPct: 10,
    staticReservePct: { mid: 0, high: 0 },
    axes: { live: true, daily: true, monthly: true },
  };
}

function metrics(
  overrides: Partial<Record<keyof DemandMetricsByBand, { requests: number; tokens: number }>> = {}
): DemandMetricsByBand {
  return {
    low: { requests: 0, tokens: 0 },
    mid: { requests: 0, tokens: 0 },
    high: { requests: 0, tokens: 0 },
    other: { requests: 0, tokens: 0 },
    ...overrides,
  };
}

function scopeDemand(
  input: {
    lookback?: Partial<DemandMetricsByBand>;
    daily?: Partial<DemandMetricsByBand>;
    monthly?: Partial<DemandMetricsByBand>;
    accountTokens?: number;
    accountByBand?: Partial<Record<keyof DemandMetricsByBand, number>>;
  } = {}
): ScopedReserveDemand {
  return {
    lookback: metrics(input.lookback),
    daily: metrics(input.daily),
    ...(input.monthly ? { monthly: metrics(input.monthly) } : {}),
    accountLookback: {
      totalTokens: input.accountTokens ?? 0,
      byBand: {
        low: 0,
        mid: 0,
        high: 0,
        other: 0,
        ...input.accountByBand,
      },
    },
  };
}

function catalogEntry(overrides: Partial<MergedEntry> = {}): MergedEntry {
  return {
    provider: "openrouter",
    modelId: "free-model",
    displayName: "Free model",
    monthlyTokens: 10_000,
    creditTokens: 0,
    freeType: "recurring-monthly",
    poolKey: null,
    tos: "ok",
    origin: "baseline",
    enabled: true,
    ...overrides,
  };
}

function usageRow(overrides: Partial<ComboForecastUsageRow> = {}): ComboForecastUsageRow {
  return {
    comboName: "auto/general_high:free",
    executionKey: null,
    stepId: null,
    provider: "openrouter",
    model: "free-model",
    requestedModel: null,
    connectionId: "account-a",
    requests: 1,
    successCount: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    avgLatencyMs: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

function makeController(input: {
  now?: Date;
  settings?: ReturnType<typeof settings>;
  entries?: MergedEntry[];
  readUsageRows?: (options: { since: string; until?: string }) => ComboForecastUsageRow[];
  readQuotaSnapshots?: (options: { since: string; until?: string }) => unknown;
}) {
  const clock = { value: input.now ?? new Date("2026-10-01T00:00:00.000Z") };
  const pending: Array<() => void> = [];
  const readUsageRows = vi.fn(input.readUsageRows ?? (() => []));
  const readQuotaSnapshots = vi.fn(input.readQuotaSnapshots ?? (() => []));
  const getCatalog = vi.fn(() => ({ entries: input.entries ?? [], meta: null }));
  const log = vi.fn<(event: ReserveRefreshEvent) => void>();
  const controller = createReserveController({
    getSettings: () => input.settings ?? settings(),
    isBandsEnabled: () =>
      process.env.OMNIROUTE_AUTO_BANDS === "1" || process.env.OMNIROUTE_AUTO_BANDS === "true",
    deps: {
      now: () => clock.value,
      readUsageRows,
      readQuotaSnapshots,
      getCatalog,
      defer: (work) => pending.push(work),
      log,
    },
  });

  return { controller, clock, pending, readUsageRows, readQuotaSnapshots, getCatalog, log };
}

afterEach(() => {
  if (originalBandsFlag === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = originalBandsFlag;
  vi.restoreAllMocks();
});

describe("auto quality band account reserve", () => {
  it("reserves daily capacity when higher-band forecast plus same/lower and other usage reaches the floor", () => {
    const result = evaluateReserveScope({
      band: "mid",
      settings: settings(),
      capacity: { source: "daily", rpd: 1_000 },
      demand: scopeDemand({
        lookback: { high: { requests: 3_500, tokens: 0 } },
        daily: {
          high: { requests: 100, tokens: 0 },
          other: { requests: 450, tokens: 0 },
        },
      }),
    });

    expect(result).toBe(true);
  });

  it("leaves daily capacity open when forecast does not reach the safety floor", () => {
    const result = evaluateReserveScope({
      band: "mid",
      settings: settings(),
      capacity: { source: "daily", rpd: 1_000 },
      demand: scopeDemand({
        lookback: { high: { requests: 1_400, tokens: 0 } },
        daily: {
          high: { requests: 50, tokens: 0 },
          other: { requests: 300, tokens: 0 },
        },
      }),
    });

    expect(result).toBe(false);
  });

  it("uses static higher-band reserve without history and reserves when either daily axis reaches capacity", () => {
    const coldStart = evaluateReserveScope({
      band: "mid",
      settings: { ...settings(), staticReservePct: { mid: 0, high: 20 } },
      capacity: { source: "daily", rpd: 1_000 },
      demand: scopeDemand({ daily: { other: { requests: 750, tokens: 0 } } }),
    });
    const tokenAxis = evaluateReserveScope({
      band: "mid",
      settings: settings(),
      capacity: { source: "daily", rpd: 10_000, tpd: 1_000 },
      demand: scopeDemand({ daily: { other: { requests: 0, tokens: 900 } } }),
    });

    expect(coldStart).toBe(true);
    expect(tokenAxis).toBe(true);
  });

  it("applies the monthly token axis and projects live burn using the account token share", () => {
    const monthly = evaluateReserveScope({
      band: "mid",
      settings: { ...settings(), axes: { live: false, daily: false, monthly: true } },
      capacity: { source: "monthly", monthlyTokens: 1_000 },
      demand: scopeDemand({
        lookback: { high: { requests: 0, tokens: 1_750 } },
        monthly: { other: { requests: 0, tokens: 800 } },
      }),
    });
    const live = evaluateReserveScope({
      band: "low",
      settings: settings(),
      capacity: {
        source: "live",
        windows: [
          {
            provider: "openrouter",
            windowKey: "daily",
            remainingPct: 30,
            hoursUntilReset: 10,
            burnedPctPerHour: 4,
          },
        ],
      },
      demand: scopeDemand({ accountTokens: 100, accountByBand: { high: 60 } }),
    });

    expect(monthly).toBe(true);
    expect(live).toBe(true);
  });

  it("forecasts higher-band monthly demand when the 30-day window has no rows", () => {
    expect(
      evaluateReserveScope({
        band: "mid",
        settings: {
          ...settings(),
          axes: { live: false, daily: false, monthly: true },
        },
        capacity: { source: "monthly", monthlyTokens: 1_000 },
        demand: scopeDemand({ lookback: { high: { requests: 0, tokens: 250 } } }),
      })
    ).toBe(true);
  });

  it("never reserves the top band, even on an exhausted live scope", () => {
    expect(
      evaluateReserveScope({
        band: "high",
        settings: settings(),
        capacity: {
          source: "live",
          windows: [
            {
              provider: "openrouter",
              windowKey: "daily",
              remainingPct: 0,
              hoursUntilReset: 24,
              burnedPctPerHour: 100,
            },
          ],
        },
        demand: scopeDemand(),
      })
    ).toBe(false);
  });

  it("defers reads, coalesces concurrent refreshes, and keeps routing checks synchronous", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    const { controller, pending, readUsageRows, readQuotaSnapshots, getCatalog } = makeController({
      entries: [catalogEntry()],
    });

    for (let index = 0; index < 10; index += 1) {
      expect(controller.getReserveSnapshot()).toBeNull();
    }

    expect(pending).toHaveLength(1);
    expect(readUsageRows).not.toHaveBeenCalled();
    expect(readQuotaSnapshots).not.toHaveBeenCalled();
    expect(getCatalog).not.toHaveBeenCalled();

    pending.shift()?.();

    const snapshot = controller.getReserveSnapshot();
    expect(snapshot?.builtAt).toBe("2026-10-01T00:00:00.000Z");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.reserved.low)).toBe(true);
    expect(Object.isFrozen(snapshot?.diagnostics.unmatchedUsage)).toBe(true);
    expect(readUsageRows).toHaveBeenCalledTimes(3);
    expect(readQuotaSnapshots).toHaveBeenCalledTimes(1);
    expect(getCatalog).toHaveBeenCalledTimes(1);
  });

  it("does no reserve reads or logging while reserve or bands are disabled", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    const disabledReserve = makeController({ settings: { ...settings(), enabled: false } });
    expect(disabledReserve.controller.getReserveSnapshot()).toBeNull();
    expect(
      disabledReserve.controller.isReserved("mid", "account-a", "openrouter", "free-model")
    ).toBe(false);
    expect(disabledReserve.pending).toHaveLength(0);
    expect(disabledReserve.readUsageRows).not.toHaveBeenCalled();
    expect(disabledReserve.readQuotaSnapshots).not.toHaveBeenCalled();
    expect(disabledReserve.log).not.toHaveBeenCalled();

    process.env.OMNIROUTE_AUTO_BANDS = "false";
    const bandsOff = makeController({ entries: [catalogEntry()] });
    expect(bandsOff.controller.getReserveSnapshot()).toBeNull();
    expect(bandsOff.pending).toHaveLength(0);
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    bandsOff.controller.getReserveSnapshot();
    process.env.OMNIROUTE_AUTO_BANDS = "false";
    bandsOff.pending.shift()?.();
    expect(bandsOff.readUsageRows).not.toHaveBeenCalled();
    expect(bandsOff.readQuotaSnapshots).not.toHaveBeenCalled();
    expect(bandsOff.getCatalog).not.toHaveBeenCalled();
    expect(bandsOff.log).not.toHaveBeenCalled();
  });

  it("uses previous fresh snapshot after refresh errors and ignores it after max age", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    let shouldFail = false;
    const { controller, clock, pending } = makeController({
      readUsageRows: () => {
        if (shouldFail) throw new Error("usage read failed");
        return [];
      },
    });

    controller.getReserveSnapshot();
    pending.shift()?.();
    const fresh = controller.getReserveSnapshot();
    expect(fresh).not.toBeNull();

    shouldFail = true;
    clock.value = new Date(clock.value.getTime() + 11 * 60_000);
    expect(controller.getReserveSnapshot()).toBe(fresh);
    pending.shift()?.();
    expect(controller.getReserveSnapshot()).toBe(fresh);

    clock.value = new Date(clock.value.getTime() + 50 * 60_000);
    expect(controller.getReserveSnapshot()).toBeNull();
    pending.shift()?.();
    expect(controller.getReserveSnapshot()).toBeNull();
  });

  it("narrows decisions by account scope and records a structured refresh diagnostic", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    const now = new Date("2026-10-01T00:00:00.000Z");
    const entry = catalogEntry({ limits: { rpm: null, rpd: 1_000, tpm: null, tpd: null } });
    const high = usageRow({ requests: 3_500 });
    const recent = [
      usageRow({ requests: 100 }),
      usageRow({ comboName: "auto/coding", requests: 450 }),
    ];
    const { controller, pending, log } = makeController({
      now,
      entries: [entry],
      readUsageRows: ({ since }) => {
        if (since === new Date(now.getTime() - 7 * DAY_MS).toISOString()) return [high];
        if (since === new Date(now.getTime() - DAY_MS).toISOString()) return recent;
        return [];
      },
    });

    expect(controller.isReserved("low", "account-a", "openrouter", "free-model")).toBe(false);
    pending.shift()?.();

    expect(controller.isReserved("mid", "account-a", "openrouter", "free-model")).toBe(true);
    expect(controller.isReserved("high", "account-a", "openrouter", "free-model")).toBe(false);
    expect(controller.isReserved("mid", "account-b", "openrouter", "free-model")).toBe(false);
    expect(
      controller
        .getReserveSnapshot()
        ?.reserved.mid.includes(capacityScopeKey("account-a", "model:openrouter/free-model"))
    ).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      kind: "reserve-refresh",
      sourceScopes: { live: 0, daily: 1, monthly: 0, none: 0 },
      reservedScopes: { low: 1, mid: 1, high: 0 },
    });
  });

  it("uses deterministic known monthly capacity for shared pools", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    const now = new Date("2026-10-01T00:00:00.000Z");
    const monthlySettings = {
      ...settings(),
      axes: { live: false, daily: false, monthly: true },
    };

    function evaluatePool(entries: MergedEntry[], highBandTokens: number): boolean[] {
      const { controller, pending } = makeController({
        now,
        settings: monthlySettings,
        entries,
        readUsageRows: ({ since }) =>
          since === new Date(now.getTime() - 7 * DAY_MS).toISOString()
            ? [usageRow({ model: "pool-a", totalTokens: highBandTokens })]
            : [],
      });
      controller.getReserveSnapshot();
      pending.shift()?.();
      return [
        controller.isReserved("mid", "account-a", "openrouter", "pool-a"),
        controller.isReserved("mid", "account-a", "openrouter", "pool-b"),
      ];
    }

    const unknownAndKnown = [
      catalogEntry({ modelId: "pool-a", poolKey: "shared", monthlyTokens: 0 }),
      catalogEntry({ modelId: "pool-b", poolKey: "shared", monthlyTokens: 1_000 }),
    ];
    const differentKnown = [
      catalogEntry({ modelId: "pool-a", poolKey: "shared", monthlyTokens: 1_000 }),
      catalogEntry({ modelId: "pool-b", poolKey: "shared", monthlyTokens: 2_000 }),
    ];

    expect(evaluatePool(unknownAndKnown, 300)).toEqual([true, true]);
    expect(evaluatePool([...unknownAndKnown].reverse(), 300)).toEqual([true, true]);
    expect(evaluatePool(differentKnown, 400)).toEqual([false, false]);
    expect(evaluatePool([...differentKnown].reverse(), 400)).toEqual([false, false]);
  });

  it("keeps identical positive daily limits for shared-pool members regardless of order", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    const now = new Date("2026-10-01T00:00:00.000Z");
    const dailySettings = {
      ...settings(),
      axes: { live: false, daily: true, monthly: false },
    };

    function evaluatePool(entries: MergedEntry[]): {
      reserved: boolean[];
      dailyScopes: number;
    } {
      const { controller, pending } = makeController({
        now,
        settings: dailySettings,
        entries,
        readUsageRows: ({ since }) => {
          if (since === new Date(now.getTime() - 7 * DAY_MS).toISOString()) {
            return [usageRow({ model: "pool-a", requests: 3_500 })];
          }
          if (since === new Date(now.getTime() - DAY_MS).toISOString()) {
            return [
              usageRow({ model: "pool-a", requests: 100 }),
              usageRow({ model: "pool-a", comboName: "auto/coding", requests: 450 }),
            ];
          }
          return [];
        },
      });
      controller.getReserveSnapshot();
      pending.shift()?.();
      const snapshot = controller.getReserveSnapshot();
      return {
        reserved: [
          controller.isReserved("mid", "account-a", "openrouter", "pool-a"),
          controller.isReserved("mid", "account-a", "openrouter", "pool-b"),
        ],
        dailyScopes: snapshot?.diagnostics.sourceScopes.daily ?? 0,
      };
    }

    const entries = [
      catalogEntry({
        modelId: "pool-a",
        poolKey: "shared",
        monthlyTokens: 0,
        limits: { rpm: null, rpd: 1_000, tpm: null, tpd: null },
      }),
      catalogEntry({
        modelId: "pool-b",
        poolKey: "shared",
        monthlyTokens: 0,
        limits: { rpm: null, rpd: 1_000, tpm: null, tpd: null },
      }),
    ];

    expect(evaluatePool(entries)).toEqual({ reserved: [true, true], dailyScopes: 1 });
    expect(evaluatePool([...entries].reverse())).toEqual({
      reserved: [true, true],
      dailyScopes: 1,
    });
  });

  it("keeps same-named pools from different providers in separate account scopes", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    const now = new Date("2026-10-01T00:00:00.000Z");
    const entries = [
      catalogEntry({
        provider: "openrouter",
        modelId: "pool-openrouter",
        poolKey: "shared",
        monthlyTokens: 1_000,
      }),
      catalogEntry({
        provider: "groq",
        modelId: "pool-groq",
        poolKey: "shared",
        monthlyTokens: 2_000,
      }),
    ];
    const { controller, pending } = makeController({
      now,
      settings: { ...settings(), axes: { live: false, daily: false, monthly: true } },
      entries,
      readUsageRows: ({ since }) =>
        since === new Date(now.getTime() - 7 * DAY_MS).toISOString()
          ? [
              usageRow({ provider: "openrouter", model: "pool-openrouter", totalTokens: 300 }),
              usageRow({ provider: "groq", model: "pool-groq", totalTokens: 300 }),
            ]
          : [],
    });

    controller.getReserveSnapshot();
    pending.shift()?.();

    expect(controller.isReserved("mid", "account-a", "openrouter", "pool-openrouter")).toBe(true);
    expect(controller.isReserved("mid", "account-a", "groq", "pool-groq")).toBe(false);
  });

  it("keeps a fresh snapshot when a pool has conflicting positive daily capacities", () => {
    process.env.OMNIROUTE_AUTO_BANDS = "1";
    const now = new Date("2026-10-01T00:00:00.000Z");
    let currentNow = now;
    const entries = [
      catalogEntry({
        modelId: "pool-a",
        poolKey: "shared",
        limits: { rpm: null, rpd: 1_000, tpm: null, tpd: null },
      }),
    ];
    const { controller, clock, pending, log } = makeController({
      now,
      entries,
      readUsageRows: ({ since }) => {
        const high = usageRow({ model: "pool-a", requests: 3_500 });
        const daily = [
          usageRow({ model: "pool-a", requests: 100 }),
          usageRow({ model: "pool-a", comboName: "auto/coding", requests: 450 }),
        ];
        if (since === new Date(currentNow.getTime() - 7 * DAY_MS).toISOString()) return [high];
        if (since === new Date(currentNow.getTime() - DAY_MS).toISOString()) return daily;
        return [];
      },
    });

    controller.getReserveSnapshot();
    pending.shift()?.();
    expect(controller.isReserved("mid", "account-a", "openrouter", "pool-a")).toBe(true);

    currentNow = new Date(now.getTime() + 11 * 60_000);
    clock.value = currentNow;
    entries.push(
      catalogEntry({
        modelId: "pool-b",
        poolKey: "shared",
        limits: { rpm: null, rpd: 500, tpm: null, tpd: null },
      })
    );
    expect(controller.isReserved("mid", "account-a", "openrouter", "pool-a")).toBe(true);
    pending.shift()?.();

    expect(controller.isReserved("mid", "account-a", "openrouter", "pool-a")).toBe(true);
    expect(log.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: "reserve-refresh-error",
      error: expect.stringContaining("daily rpd"),
    });
  });
});
