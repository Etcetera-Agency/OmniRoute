import type { FmoPlanningPool, FmoQuotaAxes } from "./types";

const DEFAULT_TOKENS_PER_REQUEST = 2000;
const MIN_TOKENS_PER_REQUEST = 256;
const MAX_TOKENS_PER_REQUEST = 128_000;
const RATE_LIMIT_DISCOUNT = 0.5;

const WORKLOAD_CLASS_WEIGHTS: Record<string, number> = {
  light: 1000,
  default: DEFAULT_TOKENS_PER_REQUEST,
  coding: 4000,
  analysis: 8000,
  long_context: 16_000,
};

let globalTokensPerRequest = DEFAULT_TOKENS_PER_REQUEST;

function clampTokensPerRequest(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TOKENS_PER_REQUEST;
  return Math.max(MIN_TOKENS_PER_REQUEST, Math.min(MAX_TOKENS_PER_REQUEST, value));
}

export function resetFmoTokensPerRequestForTests(): void {
  globalTokensPerRequest = DEFAULT_TOKENS_PER_REQUEST;
}

export function getFmoTokensPerRequest(): number {
  return globalTokensPerRequest;
}

export function observeFmoTokensPerRequest(
  observedTokens: number,
  observedRequests: number
): number {
  if (observedRequests <= 0) return globalTokensPerRequest;
  globalTokensPerRequest = clampTokensPerRequest(observedTokens / observedRequests);
  return globalTokensPerRequest;
}

export function resolveFmoTokensPerRequest(pool: Pick<FmoPlanningPool, "workload_class">): number {
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
