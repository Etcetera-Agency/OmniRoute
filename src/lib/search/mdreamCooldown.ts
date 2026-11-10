import { getCachedSettings } from "@/lib/db/readCache";
import {
  mdreamCooldownRemaining,
  recordMdreamCooldown,
  clearMdreamCooldownBefore,
} from "@/lib/db/mdreamCooldown";
import { resolveResilienceSettings } from "@/lib/resilience/settings";
import { checkFallbackError } from "@omniroute/open-sse/services/accountFallback.ts";
import type { WebFetchResult } from "@omniroute/open-sse/handlers/webFetch.ts";

export { mdreamCooldownRemaining };

export async function settleMdreamCooldown(
  result: WebFetchResult,
  startedAt: number
): Promise<number> {
  if (result.success) {
    clearMdreamCooldownBefore(startedAt);
    return 0;
  }
  if (result.status !== 429) return 0;
  const fallback = checkFallbackError(429, null, 0, null, "mdream");
  const configured = resolveResilienceSettings(await getCachedSettings()).providerQuotaOverrides
    .mdream?.rateLimitCooldownSeconds;
  const hintedMs = result.retryAfter ? new Date(result.retryAfter).getTime() - Date.now() : 0;
  return recordMdreamCooldown(
    fallback.cooldownMs,
    hintedMs > 0 ? hintedMs : configured ? configured * 1000 : undefined
  );
}
