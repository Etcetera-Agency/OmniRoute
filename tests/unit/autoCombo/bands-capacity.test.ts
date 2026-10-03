import { afterEach, describe, expect, it, vi } from "vitest";
import type { MergedEntry } from "../../../src/lib/radar/applyFeed";
import {
  capacityKeyForCatalogEntry,
  capacityScopeKey,
  parseRuntimeQuotaRows,
  resolveCapacityForScope,
  type RuntimeQuotaSnapshotRow,
} from "../../../open-sse/services/autoCombo/bands/capacity";

const quotaDb = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("../../../src/lib/db/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/db/core")>();
  return {
    ...actual,
    getDbInstance: () => ({
      prepare: () => ({ all: () => quotaDb.rows }),
    }),
  };
});

import { getQuotaSnapshots } from "../../../src/lib/db/quotaSnapshots";

const now = new Date("2026-10-01T00:00:00.000Z");
const axes = { live: true, daily: true, monthly: true };

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

function quotaRow(overrides: Partial<RuntimeQuotaSnapshotRow> = {}): RuntimeQuotaSnapshotRow {
  return {
    id: 1,
    provider: "openrouter",
    connectionId: "account-a",
    windowKey: "daily",
    remainingPercentage: 40,
    isExhausted: 0,
    nextResetAt: "2026-10-01T12:00:00.000Z",
    windowDurationMs: 24 * 60 * 60_000,
    rawData: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  quotaDb.rows = [];
  vi.restoreAllMocks();
});

describe("auto quality band capacity", () => {
  it("uses a shared pool key within one account and keeps accounts separate", () => {
    const firstModel = catalogEntry({ modelId: "model-a", poolKey: "shared-free" });
    const secondModel = catalogEntry({ modelId: "model-b", poolKey: "shared-free" });

    expect(capacityKeyForCatalogEntry(firstModel)).toBe("pool:shared-free");
    expect(capacityKeyForCatalogEntry(secondModel)).toBe("pool:shared-free");
    expect(capacityScopeKey("account-a", capacityKeyForCatalogEntry(firstModel))).toBe(
      capacityScopeKey("account-a", capacityKeyForCatalogEntry(secondModel))
    );
    expect(capacityScopeKey("account-a", "pool:shared-free")).not.toBe(
      capacityScopeKey("account-b", "pool:shared-free")
    );
    expect(capacityKeyForCatalogEntry(catalogEntry({ poolKey: null }))).toBe(
      "model:openrouter/free-model"
    );
  });

  it("prefers fresh live windows over daily and monthly catalog limits", () => {
    const result = resolveCapacityForScope({
      connectionId: "account-a",
      entry: catalogEntry({
        limits: { rpm: null, rpd: 1_000, tpm: null, tpd: 80_000 },
      }),
      quotaSnapshots: [quotaRow()],
      now,
      maxSnapshotAgeMinutes: 30,
      axes,
    });

    expect(result).toEqual({
      source: "live",
      windows: [
        expect.objectContaining({
          provider: "openrouter",
          windowKey: "daily",
          remainingPct: 40,
          hoursUntilReset: 12,
        }),
      ],
    });
  });

  it("measures burn only after the latest reset within the lookback", () => {
    const result = resolveCapacityForScope({
      connectionId: "account-a",
      entry: catalogEntry(),
      quotaSnapshots: [
        quotaRow({ id: 1, remainingPercentage: 30, createdAt: "2026-09-30T23:35:00.000Z" }),
        quotaRow({ id: 2, remainingPercentage: 100, createdAt: "2026-09-30T23:45:00.000Z" }),
        quotaRow({ id: 3, remainingPercentage: 30, createdAt: "2026-09-30T23:55:00.000Z" }),
      ],
      now,
      maxSnapshotAgeMinutes: 30,
      axes,
    });

    expect(result.source).toBe("live");
    if (result.source !== "live") throw new Error("expected live capacity");
    expect(result.windows[0]?.burnedPctPerHour).toBe(420);
  });

  it("uses daily request and token limits when no usable live window exists", () => {
    const result = resolveCapacityForScope({
      connectionId: "account-a",
      entry: catalogEntry({
        limits: { rpm: null, rpd: 1_000, tpm: null, tpd: 80_000 },
      }),
      quotaSnapshots: [
        quotaRow({ createdAt: "2026-09-30T23:29:00.000Z" }),
        quotaRow({ createdAt: "2026-09-30T23:59:00.000Z", nextResetAt: null }),
      ],
      now,
      maxSnapshotAgeMinutes: 30,
      axes,
    });

    expect(result).toEqual({ source: "daily", rpd: 1_000, tpd: 80_000 });
  });

  it("uses monthly tokens after daily limits are disabled and returns none without capacity", () => {
    const monthly = resolveCapacityForScope({
      connectionId: "account-a",
      entry: catalogEntry({ limits: undefined }),
      quotaSnapshots: [],
      now,
      maxSnapshotAgeMinutes: 30,
      axes: { live: false, daily: false, monthly: true },
    });
    const none = resolveCapacityForScope({
      connectionId: "account-a",
      entry: catalogEntry({ monthlyTokens: 0, limits: undefined }),
      quotaSnapshots: [],
      now,
      maxSnapshotAgeMinutes: 30,
      axes: { live: false, daily: false, monthly: true },
    });

    expect(monthly).toEqual({ source: "monthly", monthlyTokens: 10_000 });
    expect(none).toEqual({ source: "none" });
  });

  it("consumes the actual quota getter's camelCase rowToCamel output", () => {
    quotaDb.rows = [
      {
        id: 7,
        provider: "openrouter",
        connection_id: "account-a",
        window_key: "daily",
        remaining_percentage: 40,
        is_exhausted: 1,
        next_reset_at: "2026-10-01T12:00:00.000Z",
        window_duration_ms: 24 * 60 * 60_000,
        raw_data: null,
        created_at: "2026-10-01T00:00:00.000Z",
      },
    ];

    const rows = getQuotaSnapshots({ since: "2026-09-30T23:30:00.000Z", until: now.toISOString() });

    expect(rows[0]).toMatchObject({
      id: 7,
      connectionId: "account-a",
      windowKey: "daily",
      remainingPercentage: 40,
      isExhausted: 1,
      nextResetAt: "2026-10-01T12:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    expect(rows[0]).not.toHaveProperty("connection_id");
    expect(parseRuntimeQuotaRows(rows)).toEqual([quotaRow({ id: 7, isExhausted: 1 })]);
  });

  it("rejects a snake_case or malformed quota row instead of guessing field shape", () => {
    expect(() =>
      parseRuntimeQuotaRows([
        {
          id: 7,
          provider: "openrouter",
          connection_id: "account-a",
          window_key: "daily",
          remaining_percentage: 40,
          is_exhausted: 0,
          next_reset_at: "2026-10-01T12:00:00.000Z",
          window_duration_ms: 24 * 60 * 60_000,
          raw_data: null,
          created_at: "2026-10-01T00:00:00.000Z",
        },
      ])
    ).toThrow("quota snapshot row 0.connectionId must be a non-empty string");
  });
});
