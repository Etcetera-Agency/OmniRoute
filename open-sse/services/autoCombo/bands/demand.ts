import { getComboForecastUsageRows, type ComboForecastUsageRow } from "@/lib/db/comboForecast";
import { resolveProviderId } from "@/shared/constants/providers";
import { parseBandId, type QualityBand } from "./grammar";

const DAY_MS = 24 * 60 * 60 * 1_000;

export type DemandBand = QualityBand | "other";

export interface DemandMetrics {
  requests: number;
  tokens: number;
}

export interface BandDemandGroup {
  band: DemandBand;
  connectionId: string | null;
  provider: string;
  model: string;
  metrics: DemandMetrics;
}

export interface DemandReadOptions {
  lookbackDays: number;
  axes: { monthly: boolean };
}

export interface DemandWindows {
  lookbackMs: number;
  lookback: BandDemandGroup[];
  daily: BandDemandGroup[];
  monthly?: BandDemandGroup[];
}

type UsageRowsReader = typeof getComboForecastUsageRows;

export function classifyComboName(comboName: string): DemandBand {
  if (!comboName.startsWith("auto/")) return "other";

  const category = comboName.slice("auto/".length).split(":", 1)[0];
  return parseBandId(category)?.band ?? "other";
}

export function aggregateDemandRows(rows: readonly ComboForecastUsageRow[]): BandDemandGroup[] {
  const groups = new Map<string, BandDemandGroup>();

  for (const row of rows) {
    const band = classifyComboName(row.comboName);
    const provider = resolveProviderId(row.provider);
    const key = JSON.stringify([band, row.connectionId, provider, row.model]);
    let group = groups.get(key);

    if (!group) {
      group = {
        band,
        connectionId: row.connectionId,
        provider,
        model: row.model,
        metrics: { requests: 0, tokens: 0 },
      };
      groups.set(key, group);
    }

    group.metrics.requests += requireNonNegativeMetric(row.requests, "requests");
    group.metrics.tokens += requireNonNegativeMetric(row.totalTokens, "totalTokens");
  }

  return [...groups.values()];
}

export function forecastDemand(
  metrics: DemandMetrics,
  windowMs: number,
  lookbackMs: number
): DemandMetrics {
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new Error("windowMs must be a finite non-negative number");
  }
  if (!Number.isFinite(lookbackMs) || lookbackMs <= 0) {
    throw new Error("lookbackMs must be a finite positive number");
  }

  const scale = windowMs / lookbackMs;
  return {
    requests: requireNonNegativeMetric(metrics.requests, "requests") * scale,
    tokens: requireNonNegativeMetric(metrics.tokens, "tokens") * scale,
  };
}

// AICODE-NOTE: Call database readers only from the deferred refresh; request checks use its snapshot.
export function readDemandWindows(
  options: DemandReadOptions,
  now: Date = new Date(),
  readRows: UsageRowsReader = getComboForecastUsageRows
): DemandWindows {
  if (!Number.isFinite(options.lookbackDays) || options.lookbackDays <= 0) {
    throw new Error("lookbackDays must be a finite positive number");
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("now must be a valid date");

  const lookbackMs = options.lookbackDays * DAY_MS;
  const until = now.toISOString();
  const lookback = readRows({ since: new Date(nowMs - lookbackMs).toISOString(), until });
  const daily = readRows({ since: new Date(nowMs - DAY_MS).toISOString(), until });

  return {
    lookbackMs,
    lookback: aggregateDemandRows(lookback),
    daily: aggregateDemandRows(daily),
    ...(options.axes.monthly
      ? {
          monthly: aggregateDemandRows(
            readRows({ since: new Date(nowMs - 30 * DAY_MS).toISOString(), until })
          ),
        }
      : {}),
  };
}

function requireNonNegativeMetric(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }

  return value;
}
