/**
 * modelsDevSync.ts — Fetch model specs, pricing, and capabilities from models.dev
 *
 * models.dev (https://github.com/anomalyco/models.dev) is an open-source database
 * of AI model specifications maintained by the SST/OpenCode team (MIT license).
 *
 * API: https://models.dev/api.json
 * - 109 providers, 4,146+ models
 * - Data: pricing, capabilities, limits, modalities, metadata
 *
 * Resolution order (highest → lowest):
 *   1. User overrides (`pricing` namespace)
 *   2. models.dev sync (`models_dev_pricing` namespace)
 *   3. LiteLLM sync (`pricing_synced` namespace)
 *   4. Hardcoded defaults (`pricing.ts`)
 *
 * Settings UI (`modelsDevSyncEnabled`) controls the periodic sync by default.
 * `MODELS_DEV_SYNC_ENABLED=0|false|off|no` is a hard kill switch: it wins over
 * the DB setting so an operator can recover a wedged process (dashboard /
 * /healthz frozen on the same event loop — #10052) without the UI. Unset =
 * honor settings. `1|true|on|yes` forces sync on even if the setting is off.
 */

import { getDbInstance } from "./db/core";
import { invalidateDbCache, getModelCatalogCacheVersion } from "./db/readCache";
import { backupDbFile } from "./db/backup";
import { preserveStoredModalitySets } from "./db/models/capabilityModalities";

import {
  extractModelsDevZeroPriceModels,
  transformModelsDevToPricing,
  transformModelsDevToCapabilities,
} from "./modelsDevSync/transform";
import type {
  ModelsDevZeroPriceModels,
  PricingModels,
  PricingByProvider,
  ModelCapabilityEntry,
  CapabilitiesByProvider,
  ModelsDevData,
} from "./modelsDevSync/transform";
import { extractModelsDevModelIdentities } from "./modelsDevSync/modelIdentity";
import {
  APINEX_PUBLIC_MODELS_URL,
  bindApinexZeroPriceModels,
  composeFreshZeroPriceEvidence,
  extractApinexZeroPriceModelIds,
  isApinexCatalogNode,
  parseApinexZeroPriceEvidence,
  restrictApinexModelsToCurrentNodes,
  type ApinexCatalogNode,
  type ApinexZeroPriceEvidence,
} from "./modelsDevSync/apinex";

// Re-export the pure transform layer (moved to ./modelsDevSync/transform)
// so this module's public API is unchanged.
export {
  extractModelsDevZeroPriceModels,
  mapProviderId,
  transformModelsDevToPricing,
  transformModelsDevToCapabilities,
} from "./modelsDevSync/transform";
export type {
  ModelsDevZeroPriceModels,
  ModelCapabilityEntry,
  CapabilitiesByProvider,
  PricingByProvider,
} from "./modelsDevSync/transform";

// ─── Types ───────────────────────────────────────────────

interface SyncStatus {
  enabled: boolean;
  lastSync: string | null;
  lastSyncModelCount: number;
  lastSyncCapabilityCount: number;
  nextSync: string | null;
  intervalMs: number;
}

export interface ModelsDevZeroPriceEvidence {
  fetchedAt: string;
  modelsByProvider: ModelsDevZeroPriceModels;
}

interface SyncResult {
  success: boolean;
  modelCount: number;
  providerCount: number;
  capabilityCount: number;
  dryRun: boolean;
  data?: { pricing: PricingByProvider; capabilities: CapabilitiesByProvider };
  error?: string;
}

// ─── Configuration ───────────────────────────────────────

const MODELS_DEV_API_URL = "https://models.dev/api.json";

const parsedInterval = parseInt(process.env.MODELS_DEV_SYNC_INTERVAL || "86400", 10);
const SYNC_INTERVAL_MS =
  Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval * 1000 : 86400 * 1000;

/** Parse MODELS_DEV_SYNC_ENABLED. Invalid / empty → unset (honor DB settings). */
export function readModelsDevSyncEnvFlag(
  value: string | undefined = process.env.MODELS_DEV_SYNC_ENABLED
): "true" | "false" | "unset" {
  if (value == null) return "unset";
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return "unset";
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return "true";
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return "false";
  }
  return "unset";
}

export function isModelsDevSyncEnvDisabled(): boolean {
  return readModelsDevSyncEnvFlag() === "false";
}

export function isModelsDevSyncEnvForcedOn(): boolean {
  return readModelsDevSyncEnvFlag() === "true";
}

// ─── Periodic sync state ─────────────────────────────────

let syncTimer: ReturnType<typeof setInterval> | null = null;
let activeSyncAbortController: AbortController | null = null;
let activeSyncPromise: Promise<SyncResult> | null = null;
let activePeriodicSyncToken: { stopped: boolean } | null = null;
let lastSyncTime: string | null = null;
let lastSyncModelCount = 0;
let lastSyncCapabilityCount = 0;
let activeSyncIntervalMs = SYNC_INTERVAL_MS;
let cachedData: ModelsDevData | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let cachedCapabilities: CapabilitiesByProvider | null = null;
let cachedCapabilitiesLoadedAll = false;
const MODELS_DEV_ABORT_ERROR = "AbortError";

function createAbortError(): Error {
  const error = new Error("models.dev sync aborted");
  error.name = MODELS_DEV_ABORT_ERROR;
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === MODELS_DEV_ABORT_ERROR;
}

function createAbortedSyncResult(dryRun: boolean): SyncResult {
  return {
    success: false,
    modelCount: 0,
    providerCount: 0,
    capabilityCount: 0,
    dryRun,
    error: "aborted",
  };
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ─── Core: Fetch ─────────────────────────────────────────

/**
 * Fetch raw data from models.dev API.
 * Uses in-memory cache with 24h TTL to avoid repeated fetches.
 */
export async function fetchModelsDev(signal?: AbortSignal): Promise<ModelsDevData> {
  // Return cached data if still fresh
  if (cachedData && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedData;
  }

  const response = await fetch(MODELS_DEV_API_URL, {
    signal: signal ?? AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`models.dev fetch failed [${response.status}]: ${response.statusText}`);
  }
  const text = await response.text();
  try {
    const data = JSON.parse(text) as ModelsDevData;
    cachedData = data;
    cacheTime = Date.now();
    return data;
  } catch {
    throw new Error(`models.dev returned invalid JSON (${text.slice(0, 100)}...)`);
  }
}

// ─── DB: models.dev pricing namespace ────────────────────

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getConfiguredApinexCatalogNodes(): ApinexCatalogNode[] {
  const db = getDbInstance();
  const nodes = db
    .prepare("SELECT id, type, base_url FROM provider_nodes WHERE type = 'openai-compatible'")
    .all();
  const configuredNodes = nodes.flatMap((row) => {
    const node = toRecord(row);
    const id = node.id;
    const type = node.type;
    const baseUrl = node.base_url;
    if (typeof id !== "string" || !id || typeof type !== "string" || typeof baseUrl !== "string") {
      return [];
    }
    const candidate = { id, type, baseUrl, availableModelIds: [] };
    return isApinexCatalogNode(candidate) ? [candidate] : [];
  });
  if (configuredNodes.length === 0) return [];

  const result: ApinexCatalogNode[] = [];

  for (const node of configuredNodes) {
    const { id, type, baseUrl } = node;
    const prefix = `${id}:`;
    const syncedModels = db
      .prepare(
        "SELECT key, value FROM key_value WHERE namespace = 'syncedAvailableModels' AND key LIKE ?"
      )
      .all(`${prefix}%`);
    const availableModelIds = new Set<string>();
    let malformedModels = false;
    for (const syncedRow of syncedModels) {
      const record = toRecord(syncedRow);
      const key = record.key;
      if (typeof key !== "string" || !key.startsWith(prefix) || key.length === prefix.length) {
        continue;
      }
      if (typeof record.value !== "string") {
        malformedModels = true;
        break;
      }
      try {
        const models: unknown = JSON.parse(record.value);
        if (!Array.isArray(models)) {
          malformedModels = true;
          break;
        }
        for (const value of models) {
          const model = toRecord(value);
          const modelId = model.id;
          if (typeof modelId !== "string" || modelId.length === 0 || modelId.trim() !== modelId) {
            malformedModels = true;
            break;
          }
          availableModelIds.add(modelId);
        }
      } catch {
        malformedModels = true;
      }
      if (malformedModels) break;
    }
    if (!malformedModels)
      result.push({ id, type, baseUrl, availableModelIds: [...availableModelIds] });
  }
  return result;
}

function currentApinexModelIds(
  nodes = getConfiguredApinexCatalogNodes()
): Record<string, Set<string>> {
  return Object.fromEntries(nodes.map((node) => [node.id, new Set(node.availableModelIds)]));
}

// AICODE-NOTE: Keep APInex provenance separate; reads recompose fresh sources without writes or network.
function readApinexZeroPriceEvidence(): ApinexZeroPriceEvidence | null {
  const row = getDbInstance()
    .prepare(
      "SELECT value FROM key_value WHERE namespace = 'apinex_zero_price' AND key = 'snapshot'"
    )
    .get();
  const rawValue = toRecord(row).value;
  if (typeof rawValue !== "string") return null;
  try {
    return parseApinexZeroPriceEvidence(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

async function fetchApinexZeroPriceEvidence(
  signal?: AbortSignal
): Promise<ApinexZeroPriceEvidence | null> {
  const nodes = getConfiguredApinexCatalogNodes();
  if (nodes.length === 0) return null;

  const response = await globalThis.fetch(
    APINEX_PUBLIC_MODELS_URL,
    signal ? { signal } : undefined
  );
  if (!response.ok) {
    throw new Error(
      `APInex public catalog fetch failed [${response.status}]: ${response.statusText}`
    );
  }
  const zeroPriceModelIds = extractApinexZeroPriceModelIds(await response.json());
  return {
    sourceUrl: APINEX_PUBLIC_MODELS_URL,
    fetchedAt: new Date().toISOString(),
    modelsByProvider: bindApinexZeroPriceModels(zeroPriceModelIds, nodes),
  };
}

function parseReasoningEfforts(value: unknown): string[] | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const efforts = parsed.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0
    );
    return efforts.length > 0 ? efforts : null;
  } catch {
    return null;
  }
}

function mapCapabilityRecord(record: Record<string, unknown>): ModelCapabilityEntry {
  return {
    tool_call: record.tool_call === 1 ? true : record.tool_call === 0 ? false : null,
    reasoning: record.reasoning === 1 ? true : record.reasoning === 0 ? false : null,
    attachment: record.attachment === 1 ? true : record.attachment === 0 ? false : null,
    structured_output:
      record.structured_output === 1 ? true : record.structured_output === 0 ? false : null,
    temperature: record.temperature === 1 ? true : record.temperature === 0 ? false : null,
    modalities_input: typeof record.modalities_input === "string" ? record.modalities_input : "[]",
    modalities_output:
      typeof record.modalities_output === "string" ? record.modalities_output : "[]",
    knowledge_cutoff: typeof record.knowledge_cutoff === "string" ? record.knowledge_cutoff : null,
    release_date: typeof record.release_date === "string" ? record.release_date : null,
    last_updated: typeof record.last_updated === "string" ? record.last_updated : null,
    status: typeof record.status === "string" ? record.status : null,
    family: typeof record.family === "string" ? record.family : null,
    open_weights: record.open_weights === 1 ? true : record.open_weights === 0 ? false : null,
    limit_context: typeof record.limit_context === "number" ? record.limit_context : null,
    limit_input: typeof record.limit_input === "number" ? record.limit_input : null,
    limit_output: typeof record.limit_output === "number" ? record.limit_output : null,
    interleaved_field:
      typeof record.interleaved_field === "string" ? record.interleaved_field : null,
    reasoning_efforts: parseReasoningEfforts(record.reasoning_efforts),
  };
}

// #8697: getModelsDevPricing() re-ran the SELECT + JSON.parse of ~180 blobs on
// every call — called once per catalog model (up to ~6091x) instead of once per
// request, freezing the whole server 41-54s on a cold /v1/models rebuild.
// Memoized here, invalidated via the same modelCatalogCacheVersion signal
// save/clearModelsDevPricing already bump through invalidateDbCache("pricing") —
// reusing the existing pattern (getCachedRawProviderConnections et al. in
// db/readCache.ts) instead of introducing a new invalidation mechanism.
let pricingMemo: PricingByProvider | null = null;
let pricingMemoVersion = -1; // -1: never equals a real cacheVersion (starts at 0), guarantees a miss on the first call

/**
 * Read synced pricing from `models_dev_pricing` namespace.
 * Results are memoized until `saveModelsDevPricing` / `clearModelsDevPricing`.
 */
export function getModelsDevPricing(): PricingByProvider {
  // Kill switch: skip the SQL + JSON.parse scan entirely so a leftover
  // models_dev_pricing namespace cannot pin the event loop (#9685 / #10052).
  if (isModelsDevSyncEnvDisabled()) {
    return {};
  }

  const currentVersion = getModelCatalogCacheVersion();
  if (pricingMemo !== null && pricingMemoVersion === currentVersion) {
    return pricingMemo;
  }

  const db = getDbInstance();
  const rows = db
    .prepare("SELECT key, value FROM key_value WHERE namespace = 'models_dev_pricing'")
    .all();
  const synced: PricingByProvider = {};
  for (const row of rows) {
    const record = toRecord(row);
    const key = typeof record.key === "string" ? record.key : null;
    const rawValue = typeof record.value === "string" ? record.value : null;
    if (!key || rawValue === null) continue;
    try {
      synced[key] = JSON.parse(rawValue) as PricingModels;
    } catch {
      console.warn(`[MODELS_DEV] Corrupted pricing data for provider "${key}", skipping`);
    }
  }
  pricingMemo = synced;
  pricingMemoVersion = currentVersion;
  return synced;
}

/** Save normalized pricing and the successful sync's raw zero-price evidence atomically. */
export function saveModelsDevPricing(
  data: PricingByProvider,
  zeroPriceEvidence?: ModelsDevZeroPriceEvidence,
  apinexEvidence?: ApinexZeroPriceEvidence | null
): void {
  const db = getDbInstance();
  const currentNodes = getConfiguredApinexCatalogNodes();
  const currentModels = currentApinexModelIds(currentNodes);
  const storedApinexEvidence = readApinexZeroPriceEvidence();
  const newApinexEvidence = parseApinexZeroPriceEvidence(apinexEvidence);
  const nextApinexEvidence = newApinexEvidence ?? storedApinexEvidence;
  const freshApinexEvidence = composeFreshZeroPriceEvidence(
    null,
    nextApinexEvidence,
    currentModels,
    Date.now()
  );
  const mergedPricing: PricingByProvider = Object.fromEntries(
    Object.entries(data).map(([provider, models]) => [provider, { ...models }])
  );
  for (const [provider, models] of Object.entries(freshApinexEvidence?.modelsByProvider ?? {})) {
    mergedPricing[provider] = {
      ...(mergedPricing[provider] ?? {}),
      ...Object.fromEntries(models.map((model) => [model, { input: 0, output: 0 }])),
    };
  }

  const del = db.prepare("DELETE FROM key_value WHERE namespace = 'models_dev_pricing'");
  const insert = db.prepare(
    "INSERT INTO key_value (namespace, key, value) VALUES ('models_dev_pricing', ?, ?)"
  );
  const saveZeroPriceEvidence = db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('models_dev_zero_price', 'snapshot', ?)"
  );
  const saveApinexZeroPriceEvidence = db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('apinex_zero_price', 'snapshot', ?)"
  );
  const tx = db.transaction(() => {
    del.run();
    for (const [provider, models] of Object.entries(mergedPricing)) {
      insert.run(provider, JSON.stringify(models));
    }
    if (zeroPriceEvidence) saveZeroPriceEvidence.run(JSON.stringify(zeroPriceEvidence));
    if (newApinexEvidence) {
      saveApinexZeroPriceEvidence.run(
        JSON.stringify({
          ...newApinexEvidence,
          modelsByProvider: restrictApinexModelsToCurrentNodes(
            newApinexEvidence.modelsByProvider,
            currentModels
          ),
        })
      );
    }
  });
  tx();
  backupDbFile("pre-write");
  invalidateDbCache("pricing");
}

/** Read direct raw-provider zero-price evidence written by a successful sync. */
export function getModelsDevZeroPriceEvidence(): ModelsDevZeroPriceEvidence | null {
  if (isModelsDevSyncEnvDisabled()) return null;

  const row = getDbInstance()
    .prepare(
      "SELECT value FROM key_value WHERE namespace = 'models_dev_zero_price' AND key = 'snapshot'"
    )
    .get();
  const rawValue = toRecord(row).value;
  let modelsDevEvidence: ModelsDevZeroPriceEvidence | null = null;
  try {
    if (typeof rawValue === "string") {
      const parsed = JSON.parse(rawValue) as Partial<ModelsDevZeroPriceEvidence>;
      const modelsByProvider = parsed.modelsByProvider;
      if (
        typeof parsed.fetchedAt === "string" &&
        modelsByProvider &&
        typeof modelsByProvider === "object" &&
        !Array.isArray(modelsByProvider) &&
        Object.values(modelsByProvider).every(
          (models): models is string[] =>
            Array.isArray(models) &&
            models.every((model): model is string => typeof model === "string")
        )
      ) {
        modelsDevEvidence = { fetchedAt: parsed.fetchedAt, modelsByProvider };
      }
    }
  } catch {
    // A malformed models.dev snapshot must not suppress an independent APInex source.
  }
  return composeFreshZeroPriceEvidence(
    modelsDevEvidence,
    readApinexZeroPriceEvidence(),
    currentApinexModelIds(),
    Date.now()
  );
}

/**
 * Clear all models.dev synced pricing data.
 */
export function clearModelsDevPricing(): void {
  const db = getDbInstance();
  const clear = db.transaction(() => {
    db.prepare("DELETE FROM key_value WHERE namespace = 'models_dev_pricing'").run();
    db.prepare("DELETE FROM key_value WHERE namespace = 'models_dev_zero_price'").run();
    db.prepare("DELETE FROM key_value WHERE namespace = 'apinex_zero_price'").run();
  });
  clear();
  backupDbFile("pre-write");
  invalidateDbCache("pricing");
}

// ─── DB: model_capabilities table ────────────────────────

/**
 * Ensure the model_capabilities table exists.
 * Call this before any capability operations.
 */
export function ensureCapabilitiesTable(): void {
  const db = getDbInstance();
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_capabilities (
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      tool_call BOOLEAN,
      reasoning BOOLEAN,
      attachment BOOLEAN,
      structured_output BOOLEAN,
      temperature BOOLEAN,
      modalities_input TEXT,
      modalities_output TEXT,
      knowledge_cutoff TEXT,
      release_date TEXT,
      last_updated TEXT,
      status TEXT,
      family TEXT,
      open_weights BOOLEAN,
      limit_context INTEGER,
      limit_input INTEGER,
      limit_output INTEGER,
      interleaved_field TEXT,
      reasoning_efforts TEXT,
      last_synced TEXT,
      PRIMARY KEY (provider, model_id)
    )
  `);
}

function defineEnumerableDataProperty<T extends object>(
  target: T,
  key: string,
  value: unknown
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function capabilitiesFromRows(rows: unknown[]): CapabilitiesByProvider {
  const result: CapabilitiesByProvider = {};

  for (const row of rows) {
    const record = toRecord(row);
    const prov = typeof record.provider === "string" ? record.provider : null;
    const mid = typeof record.model_id === "string" ? record.model_id : null;
    if (!prov || !mid) continue;

    if (!Object.hasOwn(result, prov)) {
      defineEnumerableDataProperty(result, prov, {});
    }
    defineEnumerableDataProperty(result[prov], mid, mapCapabilityRecord(record));
  }

  return result;
}

/**
 * Uncached full-table models.dev capability read for build-local snapshots.
 * Shares mapping with the ordinary all-row API but never mutates the module-global
 * `cachedCapabilities` / `cachedCapabilitiesLoadedAll` runtime cache.
 */
export function loadAllSyncedCapabilitiesUncached(): CapabilitiesByProvider {
  const db = getDbInstance();
  ensureCapabilitiesTable();
  const rows = db.prepare("SELECT * FROM model_capabilities").all();
  return capabilitiesFromRows(rows);
}

/**
 * Reasoning tiers already resident in this process. A catalog/discovery read
 * must use this instead of `getSyncedCapabilities()` — that path opens SQLite
 * and runs migrations.
 */
export function peekCachedReasoningEfforts(provider: string, modelId: string): string[] | null {
  if (!cachedCapabilitiesLoadedAll || !cachedCapabilities) return null;
  const efforts = cachedCapabilities[provider]?.[modelId]?.reasoning_efforts;
  return efforts && efforts.length > 0 ? [...efforts] : null;
}

/**
 * Read synced capabilities from `model_capabilities` table.
 */
export function getSyncedCapabilities(provider?: string, modelId?: string): CapabilitiesByProvider {
  if (cachedCapabilitiesLoadedAll) {
    if (!provider) {
      return cachedCapabilities || {};
    }

    if (!modelId) {
      return cachedCapabilities?.[provider] ? { [provider]: cachedCapabilities[provider] } : {};
    }

    const providerCaps = cachedCapabilities?.[provider];
    return providerCaps?.[modelId] ? { [provider]: { [modelId]: providerCaps[modelId] } } : {};
  }

  const db = getDbInstance();
  ensureCapabilitiesTable();

  let query = "SELECT * FROM model_capabilities";
  const params: (string | number)[] = [];

  if (provider) {
    query += " WHERE provider = ?";
    params.push(provider);
    if (modelId) {
      query += " AND model_id = ?";
      params.push(modelId);
    }
  }

  const result = capabilitiesFromRows(db.prepare(query).all(...params));

  if (!provider && !modelId) {
    cachedCapabilities = result;
    cachedCapabilitiesLoadedAll = true;
  }

  return result;
}

/**
 * Resolved providers/aliases to also try when looking up a synced capability.
 * Required because models.dev has historically stored capability rows under one
 * side of an alias pair while the catalog & combo targets reference the other.
 * Without this fallback such combos end up with `context_length: null` in the
 * catalog.
 */
const SYNCED_CAPABILITY_FALLBACK_ALIASES: Record<string, string[]> = {
  "opencode-go": ["opencode-zen"],
};

function lookupSyncedCapabilityWithFallbacks(
  provider: string,
  lookup: (provider: string) => ModelCapabilityEntry | null
): ModelCapabilityEntry | null {
  const direct = lookup(provider);
  if (direct) return direct;

  const fallbacks = SYNCED_CAPABILITY_FALLBACK_ALIASES[provider];
  if (fallbacks) {
    for (const alt of fallbacks) {
      const found = lookup(alt);
      if (found) return found;
    }
  }

  return null;
}

export function getSyncedCapability(
  provider: string,
  modelId: string,
  bulk?: CapabilitiesByProvider | null
): ModelCapabilityEntry | null {
  if (!provider || !modelId) return null;

  if (bulk) {
    return lookupSyncedCapabilityWithFallbacks(provider, (p) => bulk[p]?.[modelId] ?? null);
  }

  // Fast path: every provider is in the in-memory cache, skip SQLite entirely.
  if (cachedCapabilitiesLoadedAll) {
    return lookupSyncedCapabilityWithFallbacks(
      provider,
      (p) => cachedCapabilities?.[p]?.[modelId] ?? null
    );
  }

  // Cold path: hit SQLite. Prepare the statement once, reuse for every alias.
  const db = getDbInstance();
  ensureCapabilitiesTable();
  const stmt = db.prepare(
    "SELECT * FROM model_capabilities WHERE provider = ? AND model_id = ? LIMIT 1"
  );
  return lookupSyncedCapabilityWithFallbacks(provider, (p) => {
    const row = stmt.get(p, modelId);
    if (!row) return null;
    return mapCapabilityRecord(toRecord(row));
  });
}

/**
 * Save synced capabilities to `model_capabilities` table (full replace).
 */
export function saveModelsDevCapabilities(data: CapabilitiesByProvider): void {
  const db = getDbInstance();
  ensureCapabilitiesTable();

  const del = db.prepare("DELETE FROM model_capabilities");
  const insert = db.prepare(`
    INSERT INTO model_capabilities (
      provider, model_id, tool_call, reasoning, attachment, structured_output,
      temperature, modalities_input, modalities_output, knowledge_cutoff,
      release_date, last_updated, status, family, open_weights,
      limit_context, limit_input, limit_output, interleaved_field, reasoning_efforts, last_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  let changed = false;
  const tx = db.transaction(() => {
    if (del.run().changes > 0) changed = true;
    for (const [provider, models] of Object.entries(data)) {
      for (const [modelId, cap] of Object.entries(models)) {
        const info = insert.run(
          provider,
          modelId,
          cap.tool_call === null ? null : cap.tool_call ? 1 : 0,
          cap.reasoning === null ? null : cap.reasoning ? 1 : 0,
          cap.attachment === null ? null : cap.attachment ? 1 : 0,
          cap.structured_output === null ? null : cap.structured_output ? 1 : 0,
          cap.temperature === null ? null : cap.temperature ? 1 : 0,
          cap.modalities_input,
          cap.modalities_output,
          cap.knowledge_cutoff,
          cap.release_date,
          cap.last_updated,
          cap.status,
          cap.family,
          cap.open_weights === null ? null : cap.open_weights ? 1 : 0,
          cap.limit_context,
          cap.limit_input,
          cap.limit_output,
          cap.interleaved_field,
          cap.reasoning_efforts ? JSON.stringify(cap.reasoning_efforts) : null,
          now
        );
        if (info.changes > 0) changed = true;
      }
    }
  });
  tx();
  backupDbFile("pre-write");
  cachedCapabilities = data;
  cachedCapabilitiesLoadedAll = true;
  if (changed) invalidateDbCache("model-capabilities");
}

/**
 * Insert-or-replace one provider's capability rows without wiping the table.
 * Used by the OpenRouter live catalog walk so architecture.input_modalities
 * survive into the next combo LCD (#12613).
 */
export function upsertSyncedCapabilities(
  provider: string,
  models: Record<string, ModelCapabilityEntry>
): void {
  if (!provider || Object.keys(models).length === 0) return;
  const db = getDbInstance();
  ensureCapabilitiesTable();
  const insert = db.prepare(`
    INSERT INTO model_capabilities (
      provider, model_id, tool_call, reasoning, attachment, structured_output,
      temperature, modalities_input, modalities_output, knowledge_cutoff,
      release_date, last_updated, status, family, open_weights,
      limit_context, limit_input, limit_output, interleaved_field, reasoning_efforts, last_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, model_id) DO UPDATE SET
      tool_call=excluded.tool_call,
      reasoning=excluded.reasoning,
      attachment=excluded.attachment,
      structured_output=excluded.structured_output,
      temperature=excluded.temperature,
      modalities_input=excluded.modalities_input,
      modalities_output=excluded.modalities_output,
      knowledge_cutoff=excluded.knowledge_cutoff,
      release_date=excluded.release_date,
      last_updated=excluded.last_updated,
      status=excluded.status,
      family=excluded.family,
      open_weights=excluded.open_weights,
      limit_context=excluded.limit_context,
      limit_input=excluded.limit_input,
      limit_output=excluded.limit_output,
      interleaved_field=excluded.interleaved_field,
      reasoning_efforts=excluded.reasoning_efforts,
      last_synced=excluded.last_synced
    WHERE (
      model_capabilities.tool_call, model_capabilities.reasoning,
      model_capabilities.attachment, model_capabilities.structured_output,
      model_capabilities.temperature, model_capabilities.modalities_input,
      model_capabilities.modalities_output, model_capabilities.knowledge_cutoff,
      model_capabilities.release_date, model_capabilities.last_updated,
      model_capabilities.status, model_capabilities.family, model_capabilities.open_weights,
      model_capabilities.limit_context, model_capabilities.limit_input,
      model_capabilities.limit_output, model_capabilities.interleaved_field,
      model_capabilities.reasoning_efforts
    ) IS NOT (
      excluded.tool_call, excluded.reasoning, excluded.attachment, excluded.structured_output,
      excluded.temperature, excluded.modalities_input, excluded.modalities_output,
      excluded.knowledge_cutoff, excluded.release_date, excluded.last_updated,
      excluded.status, excluded.family, excluded.open_weights,
      excluded.limit_context, excluded.limit_input, excluded.limit_output,
      excluded.interleaved_field, excluded.reasoning_efforts
    )
  `);
  const now = new Date().toISOString();
  let changed = false;
  let persistedModels = models;
  const tx = db.transaction(() => {
    persistedModels = preserveStoredModalitySets(provider, models);
    for (const [modelId, cap] of Object.entries(persistedModels)) {
      const info = insert.run(
        provider,
        modelId,
        cap.tool_call === null ? null : cap.tool_call ? 1 : 0,
        cap.reasoning === null ? null : cap.reasoning ? 1 : 0,
        cap.attachment === null ? null : cap.attachment ? 1 : 0,
        cap.structured_output === null ? null : cap.structured_output ? 1 : 0,
        cap.temperature === null ? null : cap.temperature ? 1 : 0,
        cap.modalities_input,
        cap.modalities_output,
        cap.knowledge_cutoff,
        cap.release_date,
        cap.last_updated,
        cap.status,
        cap.family,
        cap.open_weights === null ? null : cap.open_weights ? 1 : 0,
        cap.limit_context,
        cap.limit_input,
        cap.limit_output,
        cap.interleaved_field,
        cap.reasoning_efforts ? JSON.stringify(cap.reasoning_efforts) : null,
        now
      );
      // A catalog read must not invalidate its own generation just by refreshing
      // last_synced. The null-safe SQL predicate counts only semantic changes.
      if (info.changes > 0) changed = true;
    }
  });
  tx();
  if (cachedCapabilities) {
    cachedCapabilities[provider] = {
      ...(cachedCapabilities[provider] || {}),
      ...persistedModels,
    };
  }
  if (changed) invalidateDbCache("model-capabilities");
}

/**
 * Clear all synced capability data.
 */
export function clearModelsDevCapabilities(): void {
  const db = getDbInstance();
  ensureCapabilitiesTable();
  const info = db.prepare("DELETE FROM model_capabilities").run();
  backupDbFile("pre-write");
  cachedCapabilities = {};
  cachedCapabilitiesLoadedAll = true;
  if (info.changes > 0) invalidateDbCache("model-capabilities");
}

// ─── Main sync function ──────────────────────────────────

/**
 * Fetch, transform, and save pricing + capabilities from models.dev.
 */
export async function syncModelsDev(opts?: {
  dryRun?: boolean;
  syncCapabilities?: boolean;
  maxRetries?: number;
  signal?: AbortSignal;
}): Promise<SyncResult> {
  const dryRun = opts?.dryRun ?? false;
  const syncCapabilities = opts?.syncCapabilities ?? true;
  const maxRetries = opts?.maxRetries ?? 3;
  const signal = opts?.signal;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      return createAbortedSyncResult(dryRun);
    }

    try {
      const raw = await fetchModelsDev(signal);
      // AICODE-NOTE: fetchModelsDev can return its 24-hour cache; freshness must use the raw fetch time.
      const fetchedAt = new Date(cacheTime).toISOString();
      const pricing = transformModelsDevToPricing(raw);
      const zeroPriceModels = extractModelsDevZeroPriceModels(raw);
      const capabilities = syncCapabilities ? transformModelsDevToCapabilities(raw) : {};
      const catalogIdentities = syncCapabilities ? extractModelsDevModelIdentities(raw) : [];
      const modelCount = Object.values(pricing).reduce(
        (sum, models) => sum + Object.keys(models).length,
        0
      );
      const providerCount = Object.keys(pricing).length;
      const capabilityCount = syncCapabilities
        ? Object.values(capabilities).reduce((sum, models) => sum + Object.keys(models).length, 0)
        : 0;

      if (signal?.aborted) {
        return createAbortedSyncResult(dryRun);
      }

      if (!dryRun) {
        let apinexEvidence: ApinexZeroPriceEvidence | null = null;
        try {
          apinexEvidence = await fetchApinexZeroPriceEvidence(signal);
        } catch (error) {
          if (signal?.aborted) return createAbortedSyncResult(dryRun);
          console.warn(
            "[APINEX] Public pricing refresh failed:",
            error instanceof Error ? error.message : String(error)
          );
        }
        if (signal?.aborted) return createAbortedSyncResult(dryRun);

        saveModelsDevPricing(
          pricing,
          { fetchedAt, modelsByProvider: zeroPriceModels },
          apinexEvidence
        );
        if (syncCapabilities) {
          ensureCapabilitiesTable();
          saveModelsDevCapabilities(capabilities);
        }
        lastSyncTime = new Date().toISOString();
        lastSyncModelCount = modelCount;
        lastSyncCapabilityCount = capabilityCount;
        if (syncCapabilities) {
          void import("./modelBenchmarkSearch")
            .then(({ refreshModelBenchmarkCatalogEvidence }) =>
              refreshModelBenchmarkCatalogEvidence(catalogIdentities, globalThis.fetch)
            )
            .catch((error) => {
              console.warn(
                "[MODEL_BENCHMARK_SEARCH] Background refresh failed:",
                error instanceof Error ? error.message : String(error)
              );
            });
        }
      }

      return {
        success: true,
        modelCount,
        providerCount,
        capabilityCount,
        dryRun,
        ...(dryRun ? { data: { pricing, capabilities } } : {}),
      };
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) {
        return createAbortedSyncResult(dryRun);
      }

      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
        console.warn(
          `[MODELS_DEV] Sync attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`,
          lastError.message
        );
        try {
          await sleepWithAbort(delayMs, signal);
        } catch (sleepError) {
          if (signal?.aborted || isAbortError(sleepError)) {
            return createAbortedSyncResult(dryRun);
          }
          throw sleepError;
        }
      }
    }
  }

  const message = lastError?.message || "Unknown error";
  console.warn(`[MODELS_DEV] Sync failed after ${maxRetries + 1} attempts:`, message);
  return {
    success: false,
    modelCount: 0,
    providerCount: 0,
    capabilityCount: 0,
    dryRun,
    error: message,
  };
}

// ─── Periodic sync ───────────────────────────────────────

/**
 * Start periodic models.dev sync (non-blocking).
 */
export function startPeriodicSync(intervalMs?: number): void {
  if (syncTimer) return; // Already running

  const interval = intervalMs ?? SYNC_INTERVAL_MS;
  activeSyncIntervalMs = interval;
  const syncToken = { stopped: false };
  activePeriodicSyncToken = syncToken;
  console.log(`[MODELS_DEV] Starting periodic sync every ${interval / 1000}s`);

  const launchSync = () => {
    if (syncToken.stopped) {
      return Promise.resolve(createAbortedSyncResult(false));
    }

    if (activeSyncPromise) return activeSyncPromise;

    const controller = new AbortController();
    activeSyncAbortController = controller;
    const promise = syncModelsDev({ signal: controller.signal }).finally(() => {
      if (activeSyncAbortController === controller) {
        activeSyncAbortController = null;
      }
      if (activeSyncPromise === promise) {
        activeSyncPromise = null;
      }
    });
    activeSyncPromise = promise;
    return promise;
  };

  // Initial sync (non-blocking)
  launchSync()
    .then((result) => {
      if (result.success) {
        console.log(
          `[MODELS_DEV] Initial sync complete: ${result.modelCount} pricing entries, ${result.capabilityCount} capabilities from ${result.providerCount} providers`
        );
      }
    })
    .catch((err) => {
      console.warn("[MODELS_DEV] Initial sync error:", err instanceof Error ? err.message : err);
    });

  syncTimer = setInterval(() => {
    launchSync()
      .then((result) => {
        if (result.success) {
          console.log(`[MODELS_DEV] Periodic sync complete: ${result.modelCount} pricing entries`);
        }
      })
      .catch((err) => {
        console.warn("[MODELS_DEV] Periodic sync error:", err instanceof Error ? err.message : err);
      });
  }, interval);

  if (syncTimer && typeof syncTimer === "object" && "unref" in syncTimer) {
    (syncTimer as { unref?: () => void }).unref?.();
  }
}

/**
 * Stop periodic sync and cleanup timer.
 */
export function stopPeriodicSync(): void {
  if (activePeriodicSyncToken) {
    activePeriodicSyncToken.stopped = true;
    activePeriodicSyncToken = null;
  }

  if (activeSyncAbortController) {
    activeSyncAbortController.abort();
    activeSyncAbortController = null;
  }

  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log("[MODELS_DEV] Periodic sync stopped");
  }
}

/**
 * Get current sync status.
 */
export function getSyncStatus(): SyncStatus {
  // If the sync timer is active, it's enabled.
  const enabled = syncTimer !== null;
  return {
    enabled,
    lastSync: lastSyncTime,
    lastSyncModelCount,
    lastSyncCapabilityCount,
    nextSync:
      syncTimer && lastSyncTime
        ? new Date(new Date(lastSyncTime).getTime() + activeSyncIntervalMs).toISOString()
        : null,
    intervalMs: activeSyncIntervalMs,
  };
}

// ─── Init (called from instrumentation-node.ts) ───────────────────

/**
 * Initialize models.dev sync if enabled.
 */
export async function initModelsDevSync(): Promise<void> {
  if (isModelsDevSyncEnvDisabled()) {
    console.log("[MODELS_DEV] Disabled (MODELS_DEV_SYNC_ENABLED=0)");
    return;
  }

  const { getSettings } = await import("@/lib/db/settings");
  const settings = await getSettings();

  if (!isModelsDevSyncEnvForcedOn() && settings.modelsDevSyncEnabled !== true) {
    console.log("[MODELS_DEV] Disabled (enable via Settings > AI or MODELS_DEV_SYNC_ENABLED=1)");
    return;
  }

  const interval = settings.modelsDevSyncInterval as number | undefined;
  startPeriodicSync(interval);
}
