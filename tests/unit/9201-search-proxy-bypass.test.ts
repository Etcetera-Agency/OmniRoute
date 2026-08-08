import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-search-proxy-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "search-proxy-test-secret";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const proxiesDb = await import("../../src/lib/db/proxies.ts");
const proxyFetch = await import("../../open-sse/utils/proxyFetch.ts");
const proxyLogger = await import("../../src/lib/proxyLogger.ts");
const { handleSearch } = await import("../../open-sse/handlers/search.ts");
const { executeSearchRequest } = await import("../../open-sse/handlers/search/searchProxy.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function seedConnection(provider: string, apiKey: string) {
  return providersDb.createProviderConnection({
    provider,
    authType: "apikey",
    name: `${provider}-${Math.random().toString(16).slice(2, 8)}`,
    apiKey,
    isActive: true,
    testStatus: "active",
  });
}

async function seedNoAuthConnection(provider: string) {
  return providersDb.createProviderConnection({
    provider,
    authType: "none",
    name: `${provider}-${Math.random().toString(16).slice(2, 8)}`,
    apiKey: null,
    isActive: true,
    testStatus: "active",
  });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("search attempts resolve independent account proxies and redact transport secrets", async () => {
  await resetStorage();
  const proxyServers = [net.createServer(), net.createServer()];
  const proxyPorts = await Promise.all(
    proxyServers.map(
      (server) =>
        new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
        })
    )
  );
  const primary = await seedConnection("brave-search", "primary-api-key");
  const fallback = await seedConnection("tavily-search", "fallback-api-key");
  const primaryProxy = await proxiesDb.createProxy({
    name: "primary-search-proxy",
    type: "http",
    host: "127.0.0.1",
    port: proxyPorts[0],
    username: "primary-user",
    password: "primary-password",
  });
  const fallbackProxy = await proxiesDb.createProxy({
    name: "fallback-search-proxy",
    type: "http",
    host: "127.0.0.1",
    port: proxyPorts[1],
    username: "fallback-user",
    password: "fallback-password",
  });
  await proxiesDb.assignProxyToScope("account", primary.id, primaryProxy.id);
  await proxiesDb.assignProxyToScope("account", fallback.id, fallbackProxy.id);

  const seenProxyUrls: string[] = [];
  let directSource = "";
  const fetchImpl = async (url: string | URL) => {
    seenProxyUrls.push(proxyFetch.resolveProxyForRequest(String(url)).proxyUrl || "direct");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    await executeSearchRequest({
      providerId: "brave-search",
      connectionId: primary.id,
      url: "https://search.example.test/v1/search?q=secret&api_key=primary-api-key",
      fetchImpl,
    });
    await executeSearchRequest({
      providerId: "tavily-search",
      connectionId: fallback.id,
      url: "https://search.example.test/v1/search?q=secret&api_key=fallback-api-key",
      fetchImpl,
    });
    await proxyFetch.runWithProxyContext(
      { type: "http", host: "127.0.0.1", port: proxyPorts[0] },
      async () => {
        await executeSearchRequest({
          providerId: "direct-search",
          connectionId: null,
          url: "https://search.example.test/v1/search?q=secret&api_key=direct-api-key",
          fetchImpl: async (url) => {
            directSource = proxyFetch.resolveProxyForRequest(String(url)).source;
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          },
        });
      }
    );
  } finally {
    for (const server of proxyServers) server.close();
  }

  assert.match(seenProxyUrls[0], new RegExp(`127\\.0\\.0\\.1:${proxyPorts[0]}`));
  assert.match(seenProxyUrls[1], new RegExp(`127\\.0\\.0\\.1:${proxyPorts[1]}`));
  assert.notEqual(seenProxyUrls[0], seenProxyUrls[1]);
  assert.equal(directSource, "direct");

  const events = proxyLogger.getProxyLogs({ provider: "brave-search" });
  const fallbackEvents = proxyLogger.getProxyLogs({ provider: "tavily-search" });
  assert.equal(events.length, 1);
  assert.equal(fallbackEvents.length, 1);
  for (const event of [...events, ...fallbackEvents]) {
    assert.equal(event.targetUrl, "https://search.example.test/v1/search");
    assert.doesNotMatch(JSON.stringify(event), /secret|api_key|password|username/i);
    assert.equal((event.proxy as Record<string, unknown> | null)?.username, undefined);
    assert.equal((event.proxy as Record<string, unknown> | null)?.password, undefined);
  }
});

test("search proxy telemetry marks non-2xx responses as errors", async () => {
  await resetStorage();
  const result = await executeSearchRequest({
    providerId: "http-error-search",
    url: "https://search.example.test/v1/search",
    fetchImpl: async () => new Response("upstream failure", { status: 503 }),
  });

  assert.equal(result.response.ok, false);
  const events = proxyLogger.getProxyLogs({ provider: "http-error-search" });
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "error");
});

test("special search providers use per-attempt proxy context and telemetry", async () => {
  await resetStorage();
  const proxyServers = [net.createServer(), net.createServer()];
  const proxyPorts = await Promise.all(
    proxyServers.map(
      (server) =>
        new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
        })
    )
  );
  const zai = await seedConnection("zai-search", "zai-special-key");
  const duck = await seedNoAuthConnection("duckduckgo-free");
  const zaiProxy = await proxiesDb.createProxy({
    name: "zai-search-proxy",
    type: "http",
    host: "127.0.0.1",
    port: proxyPorts[0],
  });
  const duckProxy = await proxiesDb.createProxy({
    name: "duck-search-proxy",
    type: "http",
    host: "127.0.0.1",
    port: proxyPorts[1],
  });
  await proxiesDb.assignProxyToScope("account", zai.id, zaiProxy.id);
  await proxiesDb.assignProxyToScope("account", duck.id, duckProxy.id);

  const originalFetch = globalThis.fetch;
  const seenSources = { zai: [] as string[], duck: [] as string[] };
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    const source = proxyFetch.resolveProxyForRequest(target).source;
    let body: Record<string, unknown> = {};
    try {
      body = init.body ? JSON.parse(String(init.body)) : {};
    } catch {
      // DuckDuckGo posts form-encoded search data rather than JSON-RPC.
    }

    if (target.includes("api.z.ai")) {
      seenSources.zai.push(source);
      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: "zai-mcp", version: "1.0" },
            },
            id: body.id,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "mcp-session-id": "zai-special" },
          }
        );
      }
      if (body.method === "tools/call") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    JSON.stringify([
                      { title: "ZAI", link: "https://example.com/zai", content: "zai result" },
                    ])
                  ),
                },
              ],
            },
            id: body.id,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(null, { status: 202 });
    }

    if (target.includes("duckduckgo.com")) {
      seenSources.duck.push(source);
      return new Response(
        `<a rel="nofollow" href="https://example.com/duck" class='result-link'>Duck</a><td class='result-snippet'>duck result</td>`,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }

    throw new Error(`unexpected search target ${target}`);
  };

  try {
    const zaiResult = await handleSearch({
      query: "zai special",
      provider: "zai-search",
      maxResults: 1,
      searchType: "web",
      credentials: { apiKey: "zai-special-key", connectionId: zai.id },
      log: null,
    });
    const duckResult = await handleSearch({
      query: "duck special",
      provider: "duckduckgo-free",
      maxResults: 1,
      searchType: "web",
      credentials: { connectionId: duck.id },
      log: null,
    });

    assert.equal(zaiResult.success, true);
    assert.equal(duckResult.success, true);
    assert.ok(seenSources.zai.length >= 2);
    assert.ok(seenSources.duck.length >= 1);
    assert.ok(seenSources.zai.every((source) => source === "context"));
    assert.ok(seenSources.duck.every((source) => source === "context"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const server of proxyServers) server.close();
  }

  const zaiEvents = proxyLogger.getProxyLogs({ provider: "zai-search" });
  const duckEvents = proxyLogger.getProxyLogs({ provider: "duckduckgo-free" });
  assert.ok(zaiEvents.some((event) => event.connectionId === zai.id));
  assert.ok(duckEvents.some((event) => event.connectionId === duck.id));
});
