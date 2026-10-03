import { resolveProviderId } from "@/shared/constants/providers";
import { getQuotaSnapshots } from "@/lib/db/quotaSnapshots";
import { getRadarCatalog, type RadarCatalogResult } from "@/lib/radar";
import type { MergedEntry } from "@/lib/radar/applyFeed";
import { getComboForecastUsageRows } from "@/lib/db/comboForecast";
import {
  capacityKeyForCatalogEntry,
  capacityScopeKey,
  parseRuntimeQuotaRows,
  resolveCapacityForScope,
  type ResolvedCapacity,
  type RuntimeQuotaSnapshotRow,
} from "./capacity";
import {
  forecastDemand,
  readDemandWindows,
  type DemandBand,
  type DemandMetrics,
  type DemandWindows,
} from "./demand";
import type { BandReserveConfig } from "./config";
import type { QualityBand } from "./grammar";

const DAY_MS = 24 * 60 * 60_000;
const BAND_ORDER: readonly QualityBand[] = ["low", "mid", "high"];
const ALL_DEMAND_BANDS: readonly DemandBand[] = [...BAND_ORDER, "other"];
type CapacitySource = "live" | "daily" | "monthly" | "none";

export type DemandMetricsByBand = Record<DemandBand, DemandMetrics>;

export interface ScopedReserveDemand {
  lookback: DemandMetricsByBand;
  daily: DemandMetricsByBand;
  monthly?: DemandMetricsByBand;
  accountLookback: {
    totalTokens: number;
    byBand: Record<DemandBand, number>;
  };
}

export interface ReserveScopeEvaluation {
  band: QualityBand;
  settings: BandReserveConfig;
  capacity: ResolvedCapacity;
  demand: ScopedReserveDemand;
  lookbackMs?: number;
}

export interface ReserveRefreshEvent {
  kind: "reserve-refresh" | "reserve-refresh-error";
  builtAt: string;
  durationMs: number;
  sourceScopes: Record<CapacitySource, number>;
  reservedScopes: Record<QualityBand, number>;
  unmatchedUsage: {
    requests: number;
    tokens: number;
    requestShare: number;
    tokenShare: number;
  };
  error?: string;
}

export interface PublicReserveSnapshot {
  builtAt: string;
  reserved: Readonly<Record<QualityBand, readonly string[]>>;
  diagnostics: ReserveRefreshEvent;
}

export interface ReserveController {
  /** Synchronously returns the last usable snapshot and schedules refresh in the background. */
  getReserveSnapshot(): PublicReserveSnapshot | null;
  /** Reads only the in-memory state; every failure is fail-open. */
  isReserved(band: QualityBand, connectionId: string, provider: string, model: string): boolean;
}

export interface ReserveRefreshDeps {
  now: () => Date;
  readUsageRows: typeof getComboForecastUsageRows;
  readQuotaSnapshots: (options: Parameters<typeof getQuotaSnapshots>[0]) => unknown;
  getCatalog: () => RadarCatalogResult;
  defer: (work: () => void) => void;
  log: (event: ReserveRefreshEvent) => void;
}

export interface CreateReserveControllerOptions {
  getSettings: () => BandReserveConfig;
  isBandsEnabled: () => boolean;
  deps?: Partial<ReserveRefreshDeps>;
}

interface ScopeDemandRows {
  lookback: DemandMetricsByBand;
  daily: DemandMetricsByBand;
  monthly?: DemandMetricsByBand;
}

interface AccountLookback {
  totalTokens: number;
  byBand: Record<DemandBand, number>;
}

interface InternalReserveState {
  snapshot: PublicReserveSnapshot;
  catalogByModel: Map<string, CatalogCapacityScope>;
  demandByScope: Map<string, ScopeDemandRows>;
  accountLookback: Map<string, AccountLookback>;
  quotaByConnection: Map<string, RuntimeQuotaSnapshotRow[]>;
  lookbackMs: number;
}

interface CatalogCapacityScope {
  provider: string;
  capacityKey: string;
  entry: MergedEntry;
  conflictingDailyAxes: readonly ("rpd" | "tpd")[];
}

interface CatalogCapacityIndexes {
  catalogByModel: Map<string, CatalogCapacityScope>;
  scopesByProvider: Map<string, CatalogCapacityScope[]>;
}

interface UsageAccounting {
  demandByScope: Map<string, ScopeDemandRows>;
  accountLookback: Map<string, AccountLookback>;
  unmatched: { requests: number; tokens: number };
  totals: { requests: number; tokens: number };
}

const defaultDeps: ReserveRefreshDeps = {
  now: () => new Date(),
  readUsageRows: getComboForecastUsageRows,
  readQuotaSnapshots: getQuotaSnapshots,
  getCatalog: getRadarCatalog,
  defer: function defer(work): void {
    setImmediate(work);
  },
  log: function log(event): void {
    console.info(JSON.stringify({ component: "auto-bands-reserve", ...event }));
  },
};

// AICODE-NOTE: Data readers stay in the deferred refresh; routing predicates use cached data only.

/**
 * Pure capacity decision. The live axis uses projected higher-band token share;
 * absolute axes compare same/lower and other usage against capacity minus floor.
 */
export function evaluateReserveScope(input: ReserveScopeEvaluation): boolean {
  const { band, settings, capacity, demand } = input;
  if (!settings.enabled || band === "high" || capacity.source === "none") return false;

  const higherBands = getHigherBands(band);
  const staticReservePct = higherBands.reduce(
    (sum, higherBand) => sum + settings.staticReservePct[higherBand],
    0
  );

  if (capacity.source === "live" && settings.axes.live) {
    const accountTokens = demand.accountLookback.totalTokens;
    const higherTokens = higherBands.reduce(
      (sum, higherBand) => sum + demand.accountLookback.byBand[higherBand],
      0
    );
    const shareAbove = accountTokens > 0 ? higherTokens / accountTokens : 0;

    return capacity.windows.some((window) => {
      const needAbove = window.burnedPctPerHour * shareAbove * window.hoursUntilReset;
      return window.remainingPct - Math.max(needAbove, staticReservePct) <= settings.floorPct;
    });
  }

  if (capacity.source === "daily" && settings.axes.daily) {
    const windowMs = DAY_MS;
    const lookbackMs = input.lookbackMs ?? settings.lookbackDays * DAY_MS;
    const forecast = forecastAboveDemand(demand.lookback, higherBands, windowMs, lookbackMs);
    const used = usedByBand(demand.daily, higherBands);
    const rest = usedByRest(demand.daily, higherBands);
    return (
      absoluteAxisReserved(
        capacity.rpd,
        used.requests,
        rest.requests,
        forecast.requests,
        staticReservePct,
        settings.floorPct
      ) ||
      absoluteAxisReserved(
        capacity.tpd,
        used.tokens,
        rest.tokens,
        forecast.tokens,
        staticReservePct,
        settings.floorPct
      )
    );
  }

  if (capacity.source === "monthly" && settings.axes.monthly) {
    const windowMs = 30 * DAY_MS;
    const lookbackMs = input.lookbackMs ?? settings.lookbackDays * DAY_MS;
    const forecast = forecastAboveDemand(demand.lookback, higherBands, windowMs, lookbackMs);
    const monthly = demand.monthly ?? emptyDemandMetrics();
    const used = usedByBand(monthly, higherBands);
    const rest = usedByRest(monthly, higherBands);
    return absoluteAxisReserved(
      capacity.monthlyTokens,
      used.tokens,
      rest.tokens,
      forecast.tokens,
      staticReservePct,
      settings.floorPct
    );
  }

  return false;
}

export function createReserveController(
  options: CreateReserveControllerOptions
): ReserveController {
  const deps: ReserveRefreshDeps = { ...defaultDeps, ...options.deps };
  let state: InternalReserveState | null = null;
  let refreshInFlight = false;
  let lastRefreshAttemptAt: number | null = null;

  function getCurrentSettings(): BandReserveConfig | null {
    try {
      return options.getSettings();
    } catch {
      return null;
    }
  }

  function bandsAreEnabled(): boolean {
    try {
      return options.isBandsEnabled();
    } catch {
      return false;
    }
  }

  function getNow(): Date | null {
    try {
      const now = deps.now();
      return Number.isFinite(now.getTime()) ? now : null;
    } catch {
      return null;
    }
  }

  function snapshotIsFresh(nowMs: number, maxAgeMinutes: number): boolean {
    if (!state) return false;
    const age = nowMs - Date.parse(state.snapshot.builtAt);
    return age >= 0 && age <= maxAgeMinutes * 60_000;
  }

  function scheduleRefresh(now: Date, settings: BandReserveConfig): void {
    const nowMs = now.getTime();
    if (refreshInFlight) return;
    if (
      lastRefreshAttemptAt !== null &&
      nowMs - lastRefreshAttemptAt < settings.refreshMinutes * 60_000
    ) {
      return;
    }

    refreshInFlight = true;
    lastRefreshAttemptAt = nowMs;
    try {
      deps.defer(() => {
        try {
          refreshSnapshot();
        } finally {
          refreshInFlight = false;
        }
      });
    } catch (error) {
      refreshInFlight = false;
      logRefreshError(error, now);
    }
  }

  function refreshSnapshot(): void {
    const startedAt = getNow();
    if (!startedAt) return;
    const startedMs = startedAt.getTime();
    const settings = getCurrentSettings();
    if (!bandsAreEnabled() || !settings?.enabled) return;

    try {
      const demandWindows = readDemandWindows(
        { lookbackDays: settings.lookbackDays, axes: settings.axes },
        startedAt,
        deps.readUsageRows
      );
      const quotaRows = parseRuntimeQuotaRows(
        deps.readQuotaSnapshots({
          since: new Date(startedMs - settings.maxSnapshotAgeMinutes * 60_000).toISOString(),
          until: startedAt.toISOString(),
        })
      );
      const catalog = readCatalogEntries(deps.getCatalog());
      const built = buildReserveState({
        settings,
        demandWindows,
        quotaRows,
        catalog,
        now: startedAt,
      });
      const completedAt = getNow();
      const durationMs = completedAt ? Math.max(0, completedAt.getTime() - startedMs) : 0;
      const diagnostics: ReserveRefreshEvent = {
        kind: "reserve-refresh" as const,
        builtAt: startedAt.toISOString(),
        durationMs,
        sourceScopes: built.sourceScopes,
        reservedScopes: built.reservedScopes,
        unmatchedUsage: built.unmatchedUsage,
      };
      const snapshot = freezeSnapshot({
        builtAt: startedAt.toISOString(),
        reserved: built.reserved,
        diagnostics,
      });

      state = {
        snapshot,
        catalogByModel: built.catalogByModel,
        demandByScope: built.demandByScope,
        accountLookback: built.accountLookback,
        quotaByConnection: built.quotaByConnection,
        lookbackMs: demandWindows.lookbackMs,
      };
      deps.log(snapshot.diagnostics);
    } catch (error) {
      logRefreshError(error, startedAt);
    }
  }

  function logRefreshError(error: unknown, attemptedAt: Date): void {
    const event: ReserveRefreshEvent = {
      kind: "reserve-refresh-error",
      builtAt: attemptedAt.toISOString(),
      durationMs: 0,
      sourceScopes: emptySourceCounts(),
      reservedScopes: emptyBandCounts(),
      unmatchedUsage: { requests: 0, tokens: 0, requestShare: 0, tokenShare: 0 },
      error: error instanceof Error ? error.message : String(error),
    };
    try {
      deps.log(freezeDiagnostics(event));
    } catch {
      // Diagnostics cannot make routing fail.
    }
  }

  function getReserveSnapshot(): PublicReserveSnapshot | null {
    if (!bandsAreEnabled()) return null;
    const settings = getCurrentSettings();
    const now = getNow();
    if (!settings?.enabled || !now) return null;

    scheduleRefresh(now, settings);
    return snapshotIsFresh(now.getTime(), settings.maxAgeMinutes)
      ? (state?.snapshot ?? null)
      : null;
  }

  function isReserved(
    band: QualityBand,
    connectionId: string,
    provider: string,
    model: string
  ): boolean {
    if (band === "high" || !bandsAreEnabled()) return false;
    const snapshot = getReserveSnapshot();
    if (!snapshot || !state) return false;

    try {
      const now = getNow();
      const settings = getCurrentSettings();
      if (!now || !settings?.enabled) return false;
      const scope = state.catalogByModel.get(modelKey(provider, model));
      if (!scope) return false;
      const capacity = resolveScopeCapacity(
        scope,
        connectionId,
        state.quotaByConnection.get(connectionId) ?? [],
        now,
        settings
      );
      const key = reserveScopeKey(connectionId, scope);
      const scopeDemand = state.demandByScope.get(key);
      const accountLookback = state.accountLookback.get(connectionId);
      return evaluateReserveScope({
        band,
        settings,
        capacity,
        demand: toScopedDemand(scopeDemand, accountLookback),
        lookbackMs: state.lookbackMs,
      });
    } catch {
      return false;
    }
  }

  return { getReserveSnapshot, isReserved };
}

function buildReserveState(input: {
  settings: BandReserveConfig;
  demandWindows: DemandWindows;
  quotaRows: RuntimeQuotaSnapshotRow[];
  catalog: MergedEntry[];
  now: Date;
}): Omit<InternalReserveState, "snapshot"> & {
  reserved: Record<QualityBand, string[]>;
  sourceScopes: ReserveRefreshEvent["sourceScopes"];
  reservedScopes: ReserveRefreshEvent["reservedScopes"];
  unmatchedUsage: ReserveRefreshEvent["unmatchedUsage"];
} {
  const { catalogByModel, scopesByProvider } = buildCatalogCapacityScopes(input.catalog);

  const accounting = accountUsage(input.demandWindows, catalogByModel);
  const quotaByConnection = groupQuotaRows(input.quotaRows);
  const observedScopes = collectObservedScopes(
    accounting.demandByScope,
    input.demandWindows,
    catalogByModel,
    scopesByProvider,
    quotaByConnection
  );
  const reserved = createBandScopeSets();
  const sourceScopes = emptySourceCounts();

  for (const [scopeKey, scope] of observedScopes) {
    const capacity = resolveScopeCapacity(
      scope.scope,
      scope.connectionId,
      quotaByConnection.get(scope.connectionId) ?? [],
      input.now,
      input.settings
    );
    sourceScopes[capacity.source] += 1;

    for (const band of BAND_ORDER) {
      if (
        evaluateReserveScope({
          band,
          settings: input.settings,
          capacity,
          demand: toScopedDemand(
            accounting.demandByScope.get(scopeKey),
            accounting.accountLookback.get(scope.connectionId)
          ),
          lookbackMs: input.demandWindows.lookbackMs,
        })
      ) {
        reserved[band].add(scopeKey);
      }
    }
  }

  const totals = accounting.totals;
  const unmatched = accounting.unmatched;
  const unmatchedUsage = {
    requests: unmatched.requests,
    tokens: unmatched.tokens,
    requestShare: totals.requests > 0 ? unmatched.requests / totals.requests : 0,
    tokenShare: totals.tokens > 0 ? unmatched.tokens / totals.tokens : 0,
  };
  const reservedArrays = {
    low: [...reserved.low],
    mid: [...reserved.mid],
    high: [...reserved.high],
  };

  return {
    catalogByModel,
    demandByScope: accounting.demandByScope,
    accountLookback: accounting.accountLookback,
    quotaByConnection,
    lookbackMs: input.demandWindows.lookbackMs,
    reserved: reservedArrays,
    sourceScopes,
    reservedScopes: {
      low: reserved.low.size,
      mid: reserved.mid.size,
      high: reserved.high.size,
    },
    unmatchedUsage,
  };
}

function accountUsage(
  windows: DemandWindows,
  catalogByModel: ReadonlyMap<string, CatalogCapacityScope>
): UsageAccounting {
  const demandByScope = new Map<string, ScopeDemandRows>();
  const accountLookback = new Map<string, AccountLookback>();
  const totals = { requests: 0, tokens: 0 };
  const unmatched = { requests: 0, tokens: 0 };

  for (const group of windows.lookback) {
    totals.requests += group.metrics.requests;
    totals.tokens += group.metrics.tokens;
    if (group.connectionId !== null) {
      const account = getOrCreateAccountLookback(accountLookback, group.connectionId);
      account.totalTokens += group.metrics.tokens;
      account.byBand[group.band] += group.metrics.tokens;
    }
    if (!addDemandGroup(demandByScope, catalogByModel, group, "lookback")) {
      unmatched.requests += group.metrics.requests;
      unmatched.tokens += group.metrics.tokens;
    }
  }

  for (const group of windows.daily) addDemandGroup(demandByScope, catalogByModel, group, "daily");
  for (const group of windows.monthly ?? []) {
    addDemandGroup(demandByScope, catalogByModel, group, "monthly");
  }

  return { demandByScope, accountLookback, unmatched, totals };
}

function addDemandGroup(
  demandByScope: Map<string, ScopeDemandRows>,
  catalogByModel: ReadonlyMap<string, CatalogCapacityScope>,
  group: DemandWindows["lookback"][number],
  window: "lookback" | "daily" | "monthly"
): boolean {
  if (group.connectionId === null) return false;
  const scope = catalogByModel.get(modelKey(group.provider, group.model));
  if (!scope) return false;

  const scopeKey = reserveScopeKey(group.connectionId, scope);
  let demand = demandByScope.get(scopeKey);
  if (!demand) {
    demand = {
      lookback: emptyDemandMetrics(),
      daily: emptyDemandMetrics(),
      ...(window === "monthly" ? { monthly: emptyDemandMetrics() } : {}),
    };
    demandByScope.set(scopeKey, demand);
  }
  if (window === "monthly" && !demand.monthly) demand.monthly = emptyDemandMetrics();
  addMetrics(demand[window]![group.band], group.metrics);
  return true;
}

function collectObservedScopes(
  demandByScope: Map<string, ScopeDemandRows>,
  windows: DemandWindows,
  catalogByModel: ReadonlyMap<string, CatalogCapacityScope>,
  scopesByProvider: ReadonlyMap<string, CatalogCapacityScope[]>,
  quotaByConnection: ReadonlyMap<string, RuntimeQuotaSnapshotRow[]>
): Map<string, { connectionId: string; scope: CatalogCapacityScope }> {
  const scopes = new Map<string, { connectionId: string; scope: CatalogCapacityScope }>();

  for (const group of [...windows.lookback, ...windows.daily, ...(windows.monthly ?? [])]) {
    if (group.connectionId === null) continue;
    const scope = catalogByModel.get(modelKey(group.provider, group.model));
    if (scope) addObservedScope(scopes, group.connectionId, scope);
  }

  for (const [connectionId, rows] of quotaByConnection) {
    const providers = new Set(rows.map((row) => resolveProviderId(row.provider)));
    for (const provider of providers) {
      for (const scope of scopesByProvider.get(provider) ?? []) {
        addObservedScope(scopes, connectionId, scope);
      }
    }
  }

  for (const scopeKey of demandByScope.keys()) {
    if (!scopes.has(scopeKey)) throw new Error(`demand scope ${scopeKey} has no catalog entry`);
  }
  return scopes;
}

function addObservedScope(
  scopes: Map<string, { connectionId: string; scope: CatalogCapacityScope }>,
  connectionId: string,
  scope: CatalogCapacityScope
): void {
  const key = reserveScopeKey(connectionId, scope);
  if (!scopes.has(key)) scopes.set(key, { connectionId, scope });
}

function buildCatalogCapacityScopes(entries: readonly MergedEntry[]): CatalogCapacityIndexes {
  const groupedEntries = new Map<
    string,
    { provider: string; capacityKey: string; entries: MergedEntry[] }
  >();

  for (const entry of entries) {
    const provider = resolveProviderId(entry.provider);
    const capacityKey = capacityKeyForCatalogEntry(entry);
    const groupKey = JSON.stringify([provider, capacityKey]);
    const group = groupedEntries.get(groupKey) ?? { provider, capacityKey, entries: [] };
    group.entries.push(entry);
    groupedEntries.set(groupKey, group);
  }

  const catalogByModel = new Map<string, CatalogCapacityScope>();
  const scopesByProvider = new Map<string, CatalogCapacityScope[]>();
  for (const group of groupedEntries.values()) {
    const scope = aggregateCatalogCapacityScope(group);
    const providerScopes = scopesByProvider.get(scope.provider) ?? [];
    providerScopes.push(scope);
    scopesByProvider.set(scope.provider, providerScopes);
    for (const entry of group.entries) {
      catalogByModel.set(modelKey(entry.provider, entry.modelId), scope);
    }
  }

  return { catalogByModel, scopesByProvider };
}

function aggregateCatalogCapacityScope(group: {
  provider: string;
  capacityKey: string;
  entries: readonly MergedEntry[];
}): CatalogCapacityScope {
  const first = group.entries[0];
  if (!first) throw new Error(`capacity scope ${group.capacityKey} has no catalog entries`);

  const monthlyValues = distinctPositiveValues(group.entries.map((entry) => entry.monthlyTokens));
  const rpdValues = distinctPositiveValues(group.entries.map((entry) => entry.limits?.rpd));
  const tpdValues = distinctPositiveValues(group.entries.map((entry) => entry.limits?.tpd));
  const conflictingDailyAxes = [
    ...(hasConflictingPositiveValues(rpdValues) ? ["rpd" as const] : []),
    ...(hasConflictingPositiveValues(tpdValues) ? ["tpd" as const] : []),
  ];

  // AICODE-NOTE: Monthly quota is the maximum known positive budget per account/provider/pool.
  return {
    provider: group.provider,
    capacityKey: group.capacityKey,
    entry: {
      ...first,
      provider: group.provider,
      monthlyTokens: monthlyValues.length > 0 ? Math.max(...monthlyValues) : 0,
      limits: {
        rpm: first.limits?.rpm ?? null,
        rpd: rpdValues.length === 1 ? rpdValues[0]! : null,
        tpm: first.limits?.tpm ?? null,
        tpd: tpdValues.length === 1 ? tpdValues[0]! : null,
      },
    },
    conflictingDailyAxes,
  };
}

function resolveScopeCapacity(
  scope: CatalogCapacityScope,
  connectionId: string,
  quotaSnapshots: readonly RuntimeQuotaSnapshotRow[],
  now: Date,
  settings: BandReserveConfig
): ResolvedCapacity {
  const capacity = resolveCapacityForScope({
    connectionId,
    entry: scope.entry,
    quotaSnapshots,
    now,
    maxSnapshotAgeMinutes: settings.maxSnapshotAgeMinutes,
    axes: settings.axes,
  });

  if (scope.conflictingDailyAxes.length > 0 && settings.axes.daily && capacity.source !== "live") {
    throw new Error(
      `conflicting daily ${scope.conflictingDailyAxes.join("/")} capacities for ${scope.provider}/${scope.capacityKey}`
    );
  }

  return capacity;
}

function reserveScopeKey(connectionId: string, scope: CatalogCapacityScope): string {
  const capacityKey = scope.capacityKey.startsWith("pool:")
    ? `pool:${scope.provider}/${scope.capacityKey.slice("pool:".length)}`
    : scope.capacityKey;
  return capacityScopeKey(connectionId, capacityKey);
}

function distinctPositiveValues(values: readonly (number | null | undefined)[]): number[] {
  return [
    ...new Set(
      values.filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
      )
    ),
  ];
}

function hasConflictingPositiveValues(values: readonly number[]): boolean {
  return values.length > 1;
}

function readCatalogEntries(catalog: RadarCatalogResult): MergedEntry[] {
  if (!isRecord(catalog) || !Array.isArray(catalog.entries)) {
    throw new Error("Radar catalog must contain an entries array");
  }
  return catalog.entries.map((entry, index) => validateCatalogEntry(entry, index));
}

function validateCatalogEntry(value: unknown, index: number): MergedEntry {
  if (!isRecord(value)) throw new Error(`Radar catalog entry ${index} must be an object`);
  requireNonEmptyString(value.provider, `Radar catalog entry ${index}.provider`);
  requireNonEmptyString(value.modelId, `Radar catalog entry ${index}.modelId`);
  if (value.poolKey !== undefined && value.poolKey !== null && typeof value.poolKey !== "string") {
    throw new Error(`Radar catalog entry ${index}.poolKey must be a string or null`);
  }
  requireOptionalFiniteNumber(value.monthlyTokens, `Radar catalog entry ${index}.monthlyTokens`);
  if (value.limits !== undefined && value.limits !== null) {
    if (!isRecord(value.limits))
      throw new Error(`Radar catalog entry ${index}.limits must be an object`);
    requireOptionalFiniteNumber(value.limits.rpd, `Radar catalog entry ${index}.limits.rpd`);
    requireOptionalFiniteNumber(value.limits.tpd, `Radar catalog entry ${index}.limits.tpd`);
  }
  return value as unknown as MergedEntry;
}

function groupQuotaRows(
  rows: readonly RuntimeQuotaSnapshotRow[]
): Map<string, RuntimeQuotaSnapshotRow[]> {
  const result = new Map<string, RuntimeQuotaSnapshotRow[]>();
  for (const row of rows) {
    const values = result.get(row.connectionId) ?? [];
    values.push(row);
    result.set(row.connectionId, values);
  }
  return result;
}

function toScopedDemand(
  scope: ScopeDemandRows | undefined,
  account: AccountLookback | undefined
): ScopedReserveDemand {
  return {
    lookback: scope?.lookback ?? emptyDemandMetrics(),
    daily: scope?.daily ?? emptyDemandMetrics(),
    ...(scope?.monthly ? { monthly: scope.monthly } : {}),
    accountLookback: account ?? { totalTokens: 0, byBand: emptyBandTokens() },
  };
}

function absoluteAxisReserved(
  capacity: number | undefined,
  usedAbove: number,
  usedRest: number,
  forecastAbove: number,
  staticReservePct: number,
  floorPct: number
): boolean {
  if (capacity === undefined || !Number.isFinite(capacity) || capacity <= 0) return false;
  const cap = capacity * (1 - floorPct / 100);
  const reserveStatic = (cap * staticReservePct) / 100;
  return usedRest + Math.max(usedAbove, forecastAbove, reserveStatic) >= cap;
}

function forecastAboveDemand(
  lookback: DemandMetricsByBand,
  higherBands: readonly QualityBand[],
  windowMs: number,
  lookbackMs: number
): DemandMetrics {
  const above = sumBands(lookback, higherBands);
  return forecastDemand(above, windowMs, lookbackMs);
}

function usedByBand(
  metricsByBand: DemandMetricsByBand,
  bands: readonly QualityBand[]
): DemandMetrics {
  return sumBands(metricsByBand, bands);
}

function usedByRest(
  metricsByBand: DemandMetricsByBand,
  higherBands: readonly QualityBand[]
): DemandMetrics {
  const excluded = new Set<DemandBand>(higherBands);
  return sumBands(
    metricsByBand,
    ALL_DEMAND_BANDS.filter((band) => !excluded.has(band))
  );
}

function sumBands(metricsByBand: DemandMetricsByBand, bands: readonly DemandBand[]): DemandMetrics {
  return bands.reduce(
    (sum, band) => ({
      requests: sum.requests + metricsByBand[band].requests,
      tokens: sum.tokens + metricsByBand[band].tokens,
    }),
    { requests: 0, tokens: 0 }
  );
}

function getHigherBands(band: QualityBand): QualityBand[] {
  const index = BAND_ORDER.indexOf(band);
  return BAND_ORDER.slice(index + 1);
}

function modelKey(provider: string, model: string): string {
  return JSON.stringify([resolveProviderId(provider), model]);
}

function createBandScopeSets(): Record<QualityBand, Set<string>> {
  return { low: new Set(), mid: new Set(), high: new Set() };
}

function emptyDemandMetrics(): DemandMetricsByBand {
  return {
    low: { requests: 0, tokens: 0 },
    mid: { requests: 0, tokens: 0 },
    high: { requests: 0, tokens: 0 },
    other: { requests: 0, tokens: 0 },
  };
}

function emptyBandTokens(): Record<DemandBand, number> {
  return { low: 0, mid: 0, high: 0, other: 0 };
}

function addMetrics(target: DemandMetrics, source: DemandMetrics): void {
  target.requests += source.requests;
  target.tokens += source.tokens;
}

function getOrCreateAccountLookback(
  accounts: Map<string, AccountLookback>,
  connectionId: string
): AccountLookback {
  let account = accounts.get(connectionId);
  if (!account) {
    account = { totalTokens: 0, byBand: emptyBandTokens() };
    accounts.set(connectionId, account);
  }
  return account;
}

function emptySourceCounts(): ReserveRefreshEvent["sourceScopes"] {
  return { live: 0, daily: 0, monthly: 0, none: 0 };
}

function emptyBandCounts(): ReserveRefreshEvent["reservedScopes"] {
  return { low: 0, mid: 0, high: 0 };
}

function freezeSnapshot(input: {
  builtAt: string;
  reserved: Record<QualityBand, string[]>;
  diagnostics: ReserveRefreshEvent;
}): PublicReserveSnapshot {
  const reserved = Object.freeze({
    low: Object.freeze([...input.reserved.low]),
    mid: Object.freeze([...input.reserved.mid]),
    high: Object.freeze([...input.reserved.high]),
  });
  return Object.freeze({
    builtAt: input.builtAt,
    reserved,
    diagnostics: freezeDiagnostics(input.diagnostics),
  });
}

function freezeDiagnostics(event: ReserveRefreshEvent): ReserveRefreshEvent {
  return Object.freeze({
    ...event,
    sourceScopes: Object.freeze({ ...event.sourceScopes }),
    reservedScopes: Object.freeze({ ...event.reservedScopes }),
    unmatchedUsage: Object.freeze({ ...event.unmatchedUsage }),
  });
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function requireOptionalFiniteNumber(value: unknown, name: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number, null, or undefined`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
