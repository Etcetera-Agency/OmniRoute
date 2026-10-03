import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComboForecastUsageRow } from "../../../src/lib/db/comboForecast";
import {
  aggregateDemandRows,
  classifyComboName,
  forecastDemand,
  readDemandWindows,
} from "../../../open-sse/services/autoCombo/bands/demand";

const mockGetUsageRows = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/comboForecast", () => ({
  getComboForecastUsageRows: mockGetUsageRows,
}));

function usageRow(overrides: Partial<ComboForecastUsageRow> = {}): ComboForecastUsageRow {
  return {
    comboName: "auto/general_high:free",
    executionKey: null,
    stepId: null,
    provider: "openai",
    model: "gpt-4.1",
    requestedModel: null,
    connectionId: "account-a",
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
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("auto quality band demand", () => {
  it("classifies only valid band channel IDs and treats other combos as other", () => {
    expect(classifyComboName("auto/general_high:free")).toBe("high");
    expect(classifyComboName("auto/coding_low_tools:thrifty")).toBe("low");
    expect(classifyComboName("auto/coding:free")).toBe("other");
    expect(classifyComboName("auto/custom_combo")).toBe("other");
    expect(classifyComboName("direct-model-call")).toBe("other");
  });

  it("groups requests and tokens by band, account, provider, and model", () => {
    const groups = aggregateDemandRows([
      usageRow(),
      usageRow({ requests: 2, totalTokens: 80 }),
      usageRow({ model: "gpt-4.1-mini", totalTokens: 25 }),
      usageRow({ comboName: "auto/coding", requests: 3, totalTokens: 50 }),
      usageRow({ connectionId: "account-b", totalTokens: 30 }),
    ]);

    expect(groups).toContainEqual({
      band: "high",
      connectionId: "account-a",
      provider: "openai",
      model: "gpt-4.1",
      metrics: { requests: 3, tokens: 126 },
    });
    expect(groups).toContainEqual({
      band: "other",
      connectionId: "account-a",
      provider: "openai",
      model: "gpt-4.1",
      metrics: { requests: 3, tokens: 50 },
    });
    expect(groups).toContainEqual({
      band: "high",
      connectionId: "account-a",
      provider: "openai",
      model: "gpt-4.1-mini",
      metrics: { requests: 1, tokens: 25 },
    });
    expect(groups).toContainEqual({
      band: "high",
      connectionId: "account-b",
      provider: "openai",
      model: "gpt-4.1",
      metrics: { requests: 1, tokens: 30 },
    });
  });

  it("forecasts a 7-day total linearly over 24 hours and returns zero for empty history", () => {
    expect(
      forecastDemand({ requests: 700, tokens: 14000 }, 24 * 60 * 60_000, 7 * 24 * 60 * 60_000)
    ).toEqual({
      requests: 100,
      tokens: 2000,
    });
    expect(
      forecastDemand({ requests: 0, tokens: 0 }, 30 * 24 * 60 * 60_000, 7 * 24 * 60 * 60_000)
    ).toEqual({
      requests: 0,
      tokens: 0,
    });
  });

  it("reads lookback and daily windows, with monthly history only when enabled", () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    mockGetUsageRows.mockReturnValue([]);

    const windows = readDemandWindows({ lookbackDays: 7, axes: { monthly: true } }, now);

    expect(mockGetUsageRows.mock.calls).toEqual([
      [{ since: "2026-09-24T00:00:00.000Z", until: "2026-10-01T00:00:00.000Z" }],
      [{ since: "2026-09-30T00:00:00.000Z", until: "2026-10-01T00:00:00.000Z" }],
      [{ since: "2026-09-01T00:00:00.000Z", until: "2026-10-01T00:00:00.000Z" }],
    ]);
    expect(windows.monthly).toEqual([]);

    mockGetUsageRows.mockClear();
    const withoutMonthly = readDemandWindows({ lookbackDays: 7, axes: { monthly: false } }, now);

    expect(mockGetUsageRows).toHaveBeenCalledTimes(2);
    expect(withoutMonthly.monthly).toBeUndefined();
  });
});
