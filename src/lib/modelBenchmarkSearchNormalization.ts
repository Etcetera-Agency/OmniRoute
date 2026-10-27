export const NORMALIZATION_MODEL = "auto/general_high_so:free";
export const RATE_LIMIT_RETRY_FALLBACK_MS = 15 * 60 * 1000;
export const NORMALIZATION_BLOCK_REASON = "blocked_strict_free_auto_route_unavailable" as const;

export function parseNormalizationRetryAfter(headers: Headers, now = Date.now()): string {
  const toIso = (retryAt: number): string | null => {
    const date = new Date(retryAt);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    let retryAt = Number.NaN;
    if (Number.isFinite(seconds)) {
      if (seconds >= 0) retryAt = now + seconds * 1000;
    } else {
      retryAt = Date.parse(retryAfter);
    }
    const retryAfterAt = toIso(retryAt);
    if (retryAfterAt) return retryAfterAt;
  }

  const reset = headers.get("x-ratelimit-reset")?.trim();
  if (reset) {
    const epochSeconds = Number(reset);
    let retryAt = Number.NaN;
    if (Number.isFinite(epochSeconds)) {
      if (epochSeconds >= 1_000_000_000) retryAt = epochSeconds * 1000;
    } else {
      retryAt = Date.parse(reset);
    }
    const retryAfterAt = toIso(retryAt);
    if (retryAfterAt) return retryAfterAt;
  }

  return new Date(now + RATE_LIMIT_RETRY_FALLBACK_MS).toISOString();
}
