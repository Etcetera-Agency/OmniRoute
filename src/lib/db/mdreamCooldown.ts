import { getDbInstance } from "./core";
import { BACKOFF_CONFIG } from "@omniroute/open-sse/config/errorConfig.ts";

const namespace = "providerCooldown";
const key = "mdream";
const failureWindowMs = 30 * 60 * 1000;

type State = { until: number; lastFailureAt: number; cooldownMs: number; failures: number };

function readState(): State | null {
  const row = getDbInstance()
    .prepare<{ value: string }>("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(namespace, key);
  return row ? JSON.parse(row.value) : null;
}

export function mdreamCooldownRemaining(now = Date.now()): number {
  return Math.max(0, (readState()?.until ?? 0) - now);
}

export function recordMdreamCooldown(baseMs: number, exactMs?: number, now = Date.now()): number {
  const db = getDbInstance();
  let remaining = 0;
  // AICODE-NOTE: Serialize updates across processes and never shorten an overlapping 429.
  db.immediate(() => {
    const previous = readState();
    const failures =
      previous && now - previous.lastFailureAt <= failureWindowMs + previous.cooldownMs
        ? previous.failures + 1
        : 1;
    const cooldownMs =
      exactMs && exactMs > 0
        ? exactMs
        : Math.min(
            baseMs * 2 ** Math.min(failures - 1, BACKOFF_CONFIG.maxLevel),
            BACKOFF_CONFIG.max
          );
    const until = Math.max(previous?.until ?? 0, now + cooldownMs);
    const state: State = { until, lastFailureAt: now, cooldownMs, failures };
    db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
      namespace,
      key,
      JSON.stringify(state)
    );
    remaining = until - now;
  });
  return remaining;
}

export function clearMdreamCooldownBefore(startedAt: number): void {
  const db = getDbInstance();
  db.immediate(() => {
    const state = readState();
    if (state && state.lastFailureAt < startedAt) {
      db.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?").run(namespace, key);
    }
  });
}
