import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

// Search proxy-log rows keep the HTTP status the provider actually
// returned. Real codes (incl. 429/500 from the wire) land on the journal line;
// locally synthesized codes (transport/timeout, envelope errors) stay null.

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-search-upstream-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "search-upstream-test-secret";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const proxyLogger = await import("../../src/lib/proxyLogger.ts");
const searchProxy = await import("../../open-sse/handlers/search/searchProxy.ts");
const { handleSearch } = await import("../../open-sse/handlers/search.ts");
const { SEARCH_PROVIDERS } = await import("../../open-sse/config/searchRegistry.ts");
const { closeCallLogSaves } = await import("../../src/lib/usage/callLogs.ts");

let server: http.Server;
let baseUrl = "";

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const code = Number(url.searchParams.get("code") ?? 200);
    if (url.searchParams.get("hang") === "1") return; // never respond -> caller aborts
    res.writeHead(code, {
      "Content-Type": "application/json",
      Connection: "close",
      ...(code === 429 ? { "Retry-After": "120", "X-RateLimit-Reset": "1792974000" } : {}),
    });
    if (code >= 200 && code < 300) {
      res.end(JSON.stringify({ results: [], total: 0 }));
    } else if (url.searchParams.has("long")) {
      res.end("x".repeat(800));
    } else {
      res.end(JSON.stringify({ error: `provider error ${code}` }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  proxyLogger.clearProxyLogs();
  await closeCallLogSaves(500).catch(() => {});
  try {
    core.resetDbInstance();
  } catch {}
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});

test.beforeEach(() => {
  proxyLogger.clearProxyLogs();
});

function fetchParams(pathSuffix: string, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return {
    config: SEARCH_PROVIDERS["tavily-search"],
    url: `${baseUrl}${pathSuffix}`,
    init: { method: "POST", headers: { "Content-Type": "application/json" } },
    controller,
    timer,
    query: "test query",
    searchType: "web",
    maxResults: 5,
    startTime: Date.now(),
    connectionId: undefined,
    proxy: null,
    proxyLevel: "direct",
    normalize: () => ({ results: [], totalResults: 0 }),
  };
}

async function latestUpstreamStatus() {
  const [entry] = proxyLogger.getProxyLogs();
  assert.ok(entry, "a proxy log line must have been emitted");
  return entry.upstreamStatus;
}

test("a real 429 from the wire lands on the journal line", async () => {
  const p = fetchParams("/search?code=429");
  try {
    const result = await searchProxy.executeProviderFetch(p);
    assert.equal(result.success, false);
    assert.equal(result.status, 429);
    assert.equal(await latestUpstreamStatus(), 429);
  } finally {
    clearTimeout(p.timer);
  }
});

test("429 retry headers survive provider fetch result", async () => {
  const p = { ...fetchParams("/search?code=429"), config: SEARCH_PROVIDERS["ollama-search"] };
  try {
    const result = await searchProxy.executeProviderFetch(p);
    assert.equal(result.status, 429);
    assert.equal(result.rawError, JSON.stringify({ error: "provider error 429" }));
    assert.equal(result.retryAfter, "120");
    assert.equal(result.rateLimitReset, "1792974000");
  } finally {
    clearTimeout(p.timer);
  }
});

test("raw provider errors are limited to 500 characters", async () => {
  const p = fetchParams("/search?code=429&long=1");
  try {
    const result = await searchProxy.executeProviderFetch(p);
    assert.equal(result.rawError?.length, 500);
  } finally {
    clearTimeout(p.timer);
  }
});

test("Ollama Search concurrent requests reserve slots 15 seconds apart", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const waits: number[] = [];
  try {
    globalThis.setTimeout = ((
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      waits.push(delay ?? 0);
      return originalSetTimeout(callback, 10, ...args);
    }) as typeof globalThis.setTimeout;
    await Promise.all([
      searchProxy.waitForOllamaSearchSlot("ollama-search"),
      searchProxy.waitForOllamaSearchSlot("ollama-search"),
      searchProxy.waitForOllamaSearchSlot("ollama-search"),
    ]);
    assert.equal(waits.length, 2);
    assert.ok(waits[0] >= 14_000);
    assert.ok(waits[1] >= 14_000 && waits[1] <= 15_000);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("Ollama Search pacing runs before its provider timeout starts", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const timers: number[] = [];
  let simulatedElapsedMs = 0;
  Date.now = () => originalNow() + simulatedElapsedMs;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    timers.push(delay ?? 0);
    if ((delay ?? 0) >= 14_000) {
      queueMicrotask(() => {
        simulatedElapsedMs += delay ?? 0;
        callback();
      });
    }
    return { unref() {} } as ReturnType<typeof setTimeout>;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof globalThis.clearTimeout;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ results: [], total: 0 }), {
      headers: { "content-type": "application/json" },
    });
  try {
    const search = () =>
      handleSearch({
        query: "rate limit pacing test",
        provider: "ollama-search",
        maxResults: 1,
        searchType: "web",
        credentials: { apiKey: "test-only-key" },
      });
    assert.equal((await search()).success, true);
    const results = await Promise.all([search(), search()]);
    assert.ok(results.every((result) => result.success));
    const timeoutIndices = timers.flatMap((delay, index) => (delay === 10_000 ? [index] : []));
    const waits = timers.flatMap((delay, index) => (delay >= 14_000 ? [{ delay, index }] : []));
    assert.equal(timeoutIndices.length, 3);
    assert.ok(waits.length >= 2);
    assert.ok(waits[waits.length - 1].index < timeoutIndices[timeoutIndices.length - 1]);
    assert.ok(waits.every((wait) => wait.delay >= 14_000));
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("a real 200 from the wire lands on the journal line", async () => {
  const p = fetchParams("/search?code=200");
  try {
    const result = await searchProxy.executeProviderFetch(p);
    assert.equal(result.success, true);
    assert.equal(await latestUpstreamStatus(), 200);
  } finally {
    clearTimeout(p.timer);
  }
});

test("a real 500 from the wire lands on the journal line (not the 502 transport code)", async () => {
  const p = fetchParams("/search?code=500");
  try {
    const result = await searchProxy.executeProviderFetch(p);
    assert.equal(result.success, false);
    assert.equal(result.status, 500);
    assert.equal(await latestUpstreamStatus(), 500);
  } finally {
    clearTimeout(p.timer);
  }
});

test("a caller abort (no response received) keeps null", async () => {
  const p = fetchParams("/search?hang=1", 200);
  try {
    const result = await searchProxy.executeProviderFetch(p);
    assert.equal(result.success, false);
    assert.equal(await latestUpstreamStatus(), null);
  } finally {
    clearTimeout(p.timer);
  }
});

for (const quota of [true, false]) {
  test(`an AnySearch envelope error (quota=${quota}) keeps null despite result.status`, async () => {
    const p = fetchParams("/search?code=200");
    const envelope = new Error("AnySearch envelope error") as Error & { quota?: boolean };
    envelope.name = "AnysearchSearchEnvelopeError";
    envelope.quota = quota;
    const failingNormalize = () => {
      throw envelope;
    };
    try {
      const result = await searchProxy.executeProviderFetch({
        ...p,
        normalize: failingNormalize,
      });
      assert.equal(result.success, false);
      assert.equal(result.status, quota ? 402 : 502);
      assert.equal(
        await latestUpstreamStatus(),
        null,
        "synthesized envelope codes must never reach upstream_status"
      );
    } finally {
      clearTimeout(p.timer);
    }
  });
}
