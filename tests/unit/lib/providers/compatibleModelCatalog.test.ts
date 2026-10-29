import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCompatibleCapabilityOverrides,
  compatibleCapabilityMap,
  fetchCompatibleModelCatalog,
} from "@/lib/providers/compatibleModelDiscovery";
import { buildCompatibleModelsUrl } from "@/shared/utils/compatibleProviderUrls";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Input = Parameters<typeof fetchCompatibleModelCatalog>[0];
const input = (overrides: Partial<Input> = {}): Input => ({
  type: "openai-compatible" as const,
  baseUrl: "https://gateway.example/v1",
  apiKey: "test-key",
  accessToken: "",
  providerSpecificData: {},
  fetchImpl: async () =>
    response({ data: [{ id: "model-a", object: "model", created: 1, owned_by: "gateway" }] }),
  ...overrides,
});

test("compatible models URL defaults and joins relative paths", () => {
  assert.equal(
    buildCompatibleModelsUrl("https://gateway.example/v1", undefined),
    "https://gateway.example/v1/models"
  );
  assert.equal(
    buildCompatibleModelsUrl("https://gateway.example/v1", "catalog/models"),
    "https://gateway.example/v1/catalog/models"
  );
});

test("Anthropic message endpoint base resolves models path from API root", async () => {
  let requestedUrl = "";
  const result = await fetchCompatibleModelCatalog(
    input({
      type: "anthropic-compatible",
      baseUrl: "https://gateway.example/v1/messages",
      fetchImpl: async (url: string) => {
        requestedUrl = url;
        return response({ data: [], has_more: false, last_id: "model-a" });
      },
    })
  );
  assert.equal(requestedUrl, "https://gateway.example/v1/models");
  assert.equal(result.sourceUrl, requestedUrl);
});

test("compatible capability snapshots override canonical defaults including false", () => {
  assert.deepEqual(
    applyCompatibleCapabilityOverrides(
      [{ id: "model-a", supportsVision: true, supportsTools: true, isHidden: true }],
      { "model-a": { supportsVision: false, supportsTools: false } }
    ),
    [{ id: "model-a", supportsVision: false, supportsTools: false, isHidden: true }]
  );
});

test("current discovered capability values replace cached snapshot overrides", () => {
  const staleSnapshot = { "model-a": { supportsVision: true } };
  const currentSnapshot = compatibleCapabilityMap([{ id: "model-a", supportsVision: false }]);
  assert.deepEqual(
    applyCompatibleCapabilityOverrides([{ id: "model-a", supportsVision: true }], staleSnapshot),
    [{ id: "model-a", supportsVision: true }]
  );
  assert.deepEqual(
    applyCompatibleCapabilityOverrides([{ id: "model-a", supportsVision: true }], currentSnapshot),
    [{ id: "model-a", supportsVision: false }]
  );
});

test("compatible models URL accepts same-origin absolute path and rejects cross-origin", () => {
  assert.equal(
    buildCompatibleModelsUrl("https://gateway.example/v1", "https://gateway.example/custom"),
    "https://gateway.example/custom"
  );
  assert.throws(
    () => buildCompatibleModelsUrl("https://gateway.example/v1", "https://attacker.example/models"),
    /origin/i
  );
});

test("compatible models URL rejects literal and encoded dot-segment traversal", () => {
  assert.throws(
    () => buildCompatibleModelsUrl("https://gateway.example/v1", "../private/models"),
    /dot-segment traversal/i
  );
  assert.throws(
    () =>
      buildCompatibleModelsUrl(
        "https://gateway.example/v1",
        "https://gateway.example/v1/%2e%2e/private/models"
      ),
    /dot-segment traversal/i
  );
});

test("OpenAI discovery uses bearer auth and configured endpoint only", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await fetchCompatibleModelCatalog(
    input({
      modelsPath: "/custom/models",
      fetchImpl: async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return response({
          data: [{ id: "model-a", object: "model", created: 1, owned_by: "gateway" }],
        });
      },
    })
  );
  assert.equal(result.sourceUrl, "https://gateway.example/v1/custom/models");
  assert.deepEqual(
    requests.map(({ url }) => url),
    ["https://gateway.example/v1/custom/models"]
  );
  assert.equal(new Headers(requests[0].init?.headers).get("authorization"), "Bearer test-key");
});

test("stored source URL omits query credentials while request keeps configured path", async () => {
  let requestedUrl = "";
  const result = await fetchCompatibleModelCatalog(
    input({
      modelsPath: "https://gateway.example/v1/custom?api_key=secret#models",
      fetchImpl: async (url: string) => {
        requestedUrl = url;
        return response({
          data: [{ id: "model-a", object: "model", created: 1, owned_by: "gateway" }],
        });
      },
    })
  );
  assert.equal(requestedUrl, "https://gateway.example/v1/custom?api_key=secret#models");
  assert.equal(result.sourceUrl, "https://gateway.example/v1/custom");
  assert.equal(result.sourceUrl.includes("secret"), false);
});

test("OpenAI default discovery retains standard endpoint probes", async () => {
  const requests: string[] = [];
  await fetchCompatibleModelCatalog(
    input({
      baseUrl: "https://gateway.example/v1",
      fetchImpl: async (url: string) => {
        requests.push(url);
        return response(
          requests.length === 1
            ? { error: "route unavailable" }
            : { data: [{ id: "model-a", object: "model", created: 1, owned_by: "gateway" }] }
        );
      },
    })
  );
  assert.deepEqual(requests, [
    "https://gateway.example/v1/models",
    "https://gateway.example/models",
  ]);
});

test("cross-origin endpoint is rejected before credentials are sent", async () => {
  let calls = 0;
  let receivedInit: RequestInit | undefined;
  await assert.rejects(
    fetchCompatibleModelCatalog(
      input({
        modelsPath: "https://attacker.example/models",
        fetchImpl: async (_url: string, init?: RequestInit) => {
          calls++;
          receivedInit = init;
          return response({ data: [] });
        },
      })
    ),
    /origin/i
  );
  assert.equal(calls, 0);
  assert.equal(receivedInit, undefined);
});

test("Anthropic discovery paginates completely with protocol auth headers", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const pages = [
    {
      data: [
        {
          id: "claude-a",
          display_name: "Claude A",
          capabilities: {},
          max_input_tokens: 100,
          max_tokens: 20,
        },
      ],
      has_more: true,
      last_id: "claude-a",
    },
    {
      data: [
        {
          id: "claude-b",
          display_name: "Claude B",
          capabilities: {},
          max_input_tokens: 100,
          max_tokens: 20,
        },
      ],
      has_more: false,
      last_id: "claude-b",
    },
  ];
  const result = await fetchCompatibleModelCatalog(
    input({
      type: "anthropic-compatible",
      baseUrl: "https://gateway.example/v1",
      fetchImpl: async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return response(pages[requests.length - 1]);
      },
    })
  );
  assert.equal(result.models.length, 2);
  assert.deepEqual(
    requests.map(({ url }) => url),
    ["https://gateway.example/v1/models", "https://gateway.example/v1/models?after_id=claude-a"]
  );
  assert.equal(new Headers(requests[0].init?.headers).get("x-api-key"), "test-key");
  assert.equal(new Headers(requests[0].init?.headers).get("anthropic-version"), "2023-06-01");
});

test("Anthropic discovery keeps API key and bearer token roles distinct", async () => {
  let request: RequestInit | undefined;
  await fetchCompatibleModelCatalog(
    input({
      type: "anthropic-compatible",
      apiKey: "anthropic-key",
      accessToken: "oauth-token",
      fetchImpl: async (_url: string, init?: RequestInit) => {
        request = init;
        return response({ data: [], has_more: false, last_id: "model-a" });
      },
    })
  );
  const headers = new Headers(request?.headers);
  assert.equal(headers.get("x-api-key"), "anthropic-key");
  assert.equal(headers.get("authorization"), "Bearer oauth-token");
});

test("failed explicit endpoint and incomplete Anthropic pagination reject", async () => {
  let openaiCalls = 0;
  await assert.rejects(
    fetchCompatibleModelCatalog(
      input({
        modelsPath: "/selected/models",
        fetchImpl: async () => {
          openaiCalls++;
          return response({}, 503);
        },
      })
    ),
    /503/
  );
  assert.equal(openaiCalls, 1);

  await assert.rejects(
    fetchCompatibleModelCatalog(
      input({
        type: "anthropic-compatible",
        fetchImpl: async () => response({ data: [], has_more: true }),
      })
    ),
    /cursor/i
  );

  await assert.rejects(
    fetchCompatibleModelCatalog(
      input({
        type: "anthropic-compatible",
        fetchImpl: async () => response({ data: [] }),
      })
    ),
    /pagination state/i
  );

  let pages = 0;
  await assert.rejects(
    fetchCompatibleModelCatalog(
      input({
        type: "anthropic-compatible",
        fetchImpl: async () => {
          pages++;
          return response({ data: [], has_more: true, last_id: "repeated" });
        },
      })
    ),
    /repeated cursor/i
  );
  assert.equal(pages, 2);
});
