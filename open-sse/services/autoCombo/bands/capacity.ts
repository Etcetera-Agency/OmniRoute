import { resolveProviderId } from "@/shared/constants/providers";
import type { MergedEntry } from "@/lib/radar/applyFeed";

const HOUR_MS = 60 * 60 * 1_000;

export interface RuntimeQuotaSnapshotRow {
  id: number;
  provider: string;
  connectionId: string;
  windowKey: string;
  remainingPercentage: number | null;
  isExhausted: 0 | 1;
  nextResetAt: string | null;
  windowDurationMs: number | null;
  rawData: string | null;
  createdAt: string;
}

// AICODE-NOTE: getQuotaSnapshots returns camelCase rowToCamel output;
// isExhausted stays numeric despite the snake_case public type.

export interface CapacityAxes {
  live: boolean;
  daily: boolean;
  monthly: boolean;
}

export interface LiveQuotaWindow {
  provider: string;
  windowKey: string;
  remainingPct: number;
  hoursUntilReset: number;
  burnedPctPerHour: number;
}

export type ResolvedCapacity =
  | { source: "live"; windows: LiveQuotaWindow[] }
  | { source: "daily"; rpd?: number; tpd?: number }
  | { source: "monthly"; monthlyTokens: number }
  | { source: "none" };

type CapacityCatalogEntry = Pick<
  MergedEntry,
  "provider" | "modelId" | "poolKey" | "monthlyTokens" | "limits"
>;

export function parseRuntimeQuotaRows(value: unknown): RuntimeQuotaSnapshotRow[] {
  if (!Array.isArray(value)) throw new Error("quota snapshots must be an array");

  return value.map((row, index) => parseRuntimeQuotaRow(row, index));
}

export function capacityKeyForCatalogEntry(entry: CapacityCatalogEntry): string {
  const poolKey = entry.poolKey?.trim();
  if (poolKey) return `pool:${poolKey}`;

  return `model:${resolveProviderId(entry.provider)}/${entry.modelId}`;
}

export function capacityScopeKey(connectionId: string, capacityKey: string): string {
  return `${connectionId}\u0000${capacityKey}`;
}

export function resolveCapacityForScope(input: {
  connectionId: string;
  entry: CapacityCatalogEntry;
  quotaSnapshots: readonly RuntimeQuotaSnapshotRow[];
  now: Date;
  maxSnapshotAgeMinutes: number;
  axes: CapacityAxes;
}): ResolvedCapacity {
  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("now must be a valid date");
  if (!Number.isFinite(input.maxSnapshotAgeMinutes) || input.maxSnapshotAgeMinutes <= 0) {
    throw new Error("maxSnapshotAgeMinutes must be a finite positive number");
  }

  if (input.axes.live) {
    const windows = resolveLiveQuotaWindows(
      input.connectionId,
      input.quotaSnapshots,
      nowMs,
      input.maxSnapshotAgeMinutes * 60_000
    );
    if (windows.length > 0) return { source: "live", windows };
  }

  if (input.axes.daily) {
    const rpd = positiveLimit(input.entry.limits?.rpd);
    const tpd = positiveLimit(input.entry.limits?.tpd);
    if (rpd !== undefined || tpd !== undefined) {
      return {
        source: "daily",
        ...(rpd === undefined ? {} : { rpd }),
        ...(tpd === undefined ? {} : { tpd }),
      };
    }
  }

  const monthlyTokens = input.axes.monthly ? positiveLimit(input.entry.monthlyTokens) : undefined;
  if (monthlyTokens !== undefined) return { source: "monthly", monthlyTokens };

  return { source: "none" };
}

function resolveLiveQuotaWindows(
  connectionId: string,
  rows: readonly RuntimeQuotaSnapshotRow[],
  nowMs: number,
  maxAgeMs: number
): LiveQuotaWindow[] {
  const histories = new Map<string, RuntimeQuotaSnapshotRow[]>();

  for (const row of rows) {
    if (row.connectionId !== connectionId) continue;

    const createdAtMs = Date.parse(row.createdAt);
    if (createdAtMs < nowMs - maxAgeMs || createdAtMs > nowMs) continue;
    const provider = resolveProviderId(row.provider);
    const key = JSON.stringify([provider, row.windowKey]);
    const history = histories.get(key) ?? [];
    history.push(row);
    histories.set(key, history);
  }

  const windows: LiveQuotaWindow[] = [];
  for (const history of histories.values()) {
    history.sort((left, right) => {
      const timeOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return timeOrder || left.id - right.id;
    });

    const latest = history.at(-1);
    if (!latest || latest.nextResetAt === null || latest.remainingPercentage === null) continue;

    const resetAtMs = Date.parse(latest.nextResetAt);
    const hoursUntilReset = Math.max(0, (resetAtMs - nowMs) / HOUR_MS);
    windows.push({
      provider: resolveProviderId(latest.provider),
      windowKey: latest.windowKey,
      remainingPct: latest.remainingPercentage,
      hoursUntilReset,
      burnedPctPerHour: trailingBurnRate(history),
    });
  }

  return windows;
}

function trailingBurnRate(history: readonly RuntimeQuotaSnapshotRow[]): number {
  const newestIndex = history.length - 1;
  const newest = history[newestIndex];
  if (!newest || newest.remainingPercentage === null) return 0;

  let oldestIndex = newestIndex;
  while (oldestIndex > 0) {
    const older = history[oldestIndex - 1];
    const newer = history[oldestIndex];
    if (
      older.remainingPercentage === null ||
      newer.remainingPercentage === null ||
      older.remainingPercentage < newer.remainingPercentage
    ) {
      break;
    }
    oldestIndex -= 1;
  }

  const oldest = history[oldestIndex];
  const elapsedHours = (Date.parse(newest.createdAt) - Date.parse(oldest.createdAt)) / HOUR_MS;
  if (elapsedHours <= 0) return 0;

  return Math.max(0, (oldest.remainingPercentage! - newest.remainingPercentage!) / elapsedHours);
}

function parseRuntimeQuotaRow(value: unknown, index: number): RuntimeQuotaSnapshotRow {
  if (!isRecord(value)) throw new Error(`quota snapshot row ${index} must be an object`);

  const id = requireFiniteNumber(value.id, `quota snapshot row ${index}.id`);
  if (!Number.isInteger(id)) throw new Error(`quota snapshot row ${index}.id must be an integer`);

  const provider = requireNonEmptyString(value.provider, `quota snapshot row ${index}.provider`);
  const connectionId = requireNonEmptyString(
    value.connectionId,
    `quota snapshot row ${index}.connectionId`
  );
  const windowKey = requireNonEmptyString(value.windowKey, `quota snapshot row ${index}.windowKey`);
  const remainingPercentage = requireNullablePercentage(
    value.remainingPercentage,
    `quota snapshot row ${index}.remainingPercentage`
  );
  const isExhausted = requireExhaustedFlag(
    value.isExhausted,
    `quota snapshot row ${index}.isExhausted`
  );
  const nextResetAt = requireNullableDateString(
    value.nextResetAt,
    `quota snapshot row ${index}.nextResetAt`
  );
  const windowDurationMs = requireNullableFiniteNumber(
    value.windowDurationMs,
    `quota snapshot row ${index}.windowDurationMs`
  );
  const rawData = requireNullableString(value.rawData, `quota snapshot row ${index}.rawData`);
  const createdAt = requireDateString(value.createdAt, `quota snapshot row ${index}.createdAt`);

  return {
    id,
    provider,
    connectionId,
    windowKey,
    remainingPercentage,
    isExhausted,
    nextResetAt,
    windowDurationMs,
    rawData,
    createdAt,
  };
}

function requireNullablePercentage(value: unknown, name: string): number | null {
  if (value === null) return null;
  const number = requireFiniteNumber(value, name);
  if (number < 0 || number > 100) throw new Error(`${name} must be between 0 and 100`);
  return number;
}

function requireNullableFiniteNumber(value: unknown, name: string): number | null {
  return value === null ? null : requireFiniteNumber(value, name);
}

function requireFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function requireDateString(value: unknown, name: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be a valid date string`);
  }
  return value;
}

function requireNullableDateString(value: unknown, name: string): string | null {
  return value === null ? null : requireDateString(value, name);
}

function requireNullableString(value: unknown, name: string): string | null {
  if (typeof value === "string") return value;
  if (value === null) return null;
  throw new Error(`${name} must be a string or null`);
}

function requireExhaustedFlag(value: unknown, name: string): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error(`${name} must be 0 or 1`);
  return value;
}

function positiveLimit(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
