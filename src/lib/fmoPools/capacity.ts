import { getDbInstance } from "@/lib/db/core";
import type { FmoPlanningPool, FmoQuotaAxes } from "./types";

const DEFAULT_TOKENS_PER_REQUEST = 2000;
const MIN_TOKENS_PER_REQUEST = 256;
const MAX_TOKENS_PER_REQUEST = 128_000;
const RATE_LIMIT_DISCOUNT = 0.5;
const STORAGE_NAMESPACE = "fmo_pools";
const TOKENS_PER_REQUEST_KEY = "tokens_per_request";
// EMA smoothing: a single outlier request must not whipsaw the global factor that
// every pool's capacity is computed from. The factor tracks the running average,
// moving toward each new sample by this weight.
const TOKENS_PER_REQUEST_SMOOTHING = 0.1;

const WORKLOAD_CLASS_WEIGHTS: Record<string, number> = {
  light: 1000,
  chat: 2500,
  reasoning: 8000,
  tools: 6000,
  default: DEFAULT_TOKENS_PER_REQUEST,
};

let globalTokensPerRequest = DEFAULT_TOKENS_PER_REQUEST;
let loadedPersistedTokensPerRequest = false;

function clampTokensPerRequest(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TOKENS_PER_REQUEST;
  return Math.max(MIN_TOKENS_PER_REQUEST, Math.min(MAX_TOKENS_PER_REQUEST, value));
}

function readPersistedTokensPerRequest(): number | null {
  try {
    const row = getDbInstance()
      .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
      .get(STORAGE_NAMESPACE, TOKENS_PER_REQUEST_KEY) as { value?: string } | undefined;
    if (!row?.value) return null;

    return clampTokensPerRequest(Number(row.value));
  } catch {
    return null;
  }
}

function writePersistedTokensPerRequest(value: number): void {
  try {
    getDbInstance()
      .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
      .run(STORAGE_NAMESPACE, TOKENS_PER_REQUEST_KEY, String(value));
  } catch {
    // Persistence is best-effort; capacity math still uses the in-memory learned value.
  }
}

function clearPersistedTokensPerRequest(): void {
  try {
    getDbInstance()
      .prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?")
      .run(STORAGE_NAMESPACE, TOKENS_PER_REQUEST_KEY);
  } catch {
    // Test-only cleanup must not fail when the DB is not initialized.
  }
}

function ensurePersistedTokensPerRequestLoaded(): void {
  if (loadedPersistedTokensPerRequest) return;
  loadedPersistedTokensPerRequest = true;
  globalTokensPerRequest = readPersistedTokensPerRequest() ?? DEFAULT_TOKENS_PER_REQUEST;
}

export function resetFmoTokensPerRequestForTests(options: { clearPersisted?: boolean } = {}): void {
  globalTokensPerRequest = DEFAULT_TOKENS_PER_REQUEST;
  loadedPersistedTokensPerRequest = true;
  if (options.clearPersisted !== false) clearPersistedTokensPerRequest();
}

export function reloadFmoTokensPerRequestForTests(): number {
  loadedPersistedTokensPerRequest = false;
  return getFmoTokensPerRequest();
}

export function getFmoTokensPerRequest(): number {
  ensurePersistedTokensPerRequestLoaded();
  return globalTokensPerRequest;
}

export function observeFmoTokensPerRequest(
  observedTokens: number,
  observedRequests: number
): number {
  ensurePersistedTokensPerRequestLoaded();
  if (observedRequests <= 0) return globalTokensPerRequest;
  const sample = observedTokens / observedRequests;
  if (!Number.isFinite(sample) || sample <= 0) return globalTokensPerRequest;
  const smoothed =
    globalTokensPerRequest * (1 - TOKENS_PER_REQUEST_SMOOTHING) +
    sample * TOKENS_PER_REQUEST_SMOOTHING;
  globalTokensPerRequest = clampTokensPerRequest(smoothed);
  writePersistedTokensPerRequest(globalTokensPerRequest);
  return globalTokensPerRequest;
}

export function resolveFmoTokensPerRequest(pool: Pick<FmoPlanningPool, "workload_class">): number {
  ensurePersistedTokensPerRequestLoaded();
  const classWeight =
    WORKLOAD_CLASS_WEIGHTS[pool.workload_class ?? "default"] ?? WORKLOAD_CLASS_WEIGHTS.default;
  return Math.max(classWeight, globalTokensPerRequest);
}

export function calculateFmoRequestCapacityPerDay(
  axes: FmoQuotaAxes | null,
  pool: Pick<FmoPlanningPool, "workload_class">
): number | null {
  if (!axes) return null;

  const tokensPerRequest = resolveFmoTokensPerRequest(pool);
  const bounds: number[] = [];

  if (typeof axes.tokensPerMonth === "number") {
    bounds.push(axes.tokensPerMonth / tokensPerRequest / 30);
  }
  if (typeof axes.tokensPerDay === "number") {
    bounds.push(axes.tokensPerDay / tokensPerRequest);
  }
  if (typeof axes.requestsPerDay === "number") {
    bounds.push(axes.requestsPerDay);
  }
  if (typeof axes.requestsPerMinute === "number") {
    bounds.push(axes.requestsPerMinute * 60 * 24 * RATE_LIMIT_DISCOUNT);
  }

  if (bounds.length === 0) return null;
  return Math.floor(Math.max(0, Math.min(...bounds)));
}
