import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SearchResponse } from "../../open-sse/handlers/search.ts";

type SearchRouteResponse = SearchResponse & {
  id?: string;
  cached?: boolean;
};

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-search-route-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const routingOverrides = await import("../../src/lib/routing/routingOverrides.ts");
const quotaPreflight = await import("../../open-sse/services/quotaPreflight.ts");
const searchRoute = await import("../../src/app/api/v1/search/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function seedConnection(
  provider: string,
  overrides: {
    apiKey?: string | null;
    authType?: string;
    providerSpecificData?: Record<string, unknown>;
  } = {}
) {
  return providersDb.createProviderConnection({
    provider,
    authType: overrides.authType || "apikey",
    name: `${provider}-${Math.random().toString(16).slice(2, 8)}`,
    apiKey: overrides.apiKey ?? "test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: overrides.providerSpecificData || {},
  });
}

async function seedRateLimitedConnection(provider: string) {
  return providersDb.createProviderConnection({
    provider,
    authType: "apikey",
    name: `${provider}-limited-${Math.random().toString(16).slice(2, 8)}`,
    apiKey: "rate-limited-key",
    isActive: false,
    testStatus: "unavailable",
    rateLimitedUntil: new Date(Date.now() + 60_000).toISOString(),
    providerSpecificData: {},
  });
}

async function seedPreflightConnection(provider: string, apiKey: string) {
  return providersDb.createProviderConnection({
    provider,
    authType: "apikey",
    name: `${provider}-preflight-${Math.random().toString(16).slice(2, 8)}`,
    apiKey,
    isActive: true,
    testStatus: "active",
    providerSpecificData: { quotaPreflightEnabled: true },
  });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("v1 search GET lists all 17 search providers", async () => {
  const response = await searchRoute.GET();
  const body = (await response.json()) as {
    object: string;
    data: Array<{ id: string }>;
  };
  const ids = body.data.map((item: { id: string }) => item.id);

  assert.equal(response.status, 200);
  assert.equal(body.object, "list");
  assert.equal(body.data.length, 17);
  assert.deepEqual(ids, [
    "serper-search",
    "brave-search",
    "perplexity-search",
    "exa-search",
    "tavily-search",
    "firecrawl",
    "google-pse-search",
    "linkup-search",
    "searchapi-search",
    "youcom-search",
    "searxng-search",
    "ollama-search",
    "zai-search",
    "parallel-search",
    "firecrawl-search",
    "gemini-grounded-search",
    "duckduckgo-free",
    "x-search",
  ]);
});

test("v1 search POST uses stored Linkup credentials and returns normalized results", async () => {
  await seedConnection("linkup-search", { apiKey: "linkup-key" });

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (url, init = {}) => {
    capturedUrl = String(url);
    capturedInit = init;

    return new Response(
      JSON.stringify({
        results: [
          {
            name: "Linkup result",
            url: "https://example.com/article",
            content: "Linkup snippet",
            type: "web",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute linkup",
          provider: "linkup-search",
          max_results: 1,
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;

    assert.equal(response.status, 200);
    assert.equal(capturedUrl, "https://api.linkup.so/v1/search");
    assert.equal(
      (capturedInit?.headers as Record<string, string>).Authorization,
      "Bearer linkup-key"
    );
    assert.equal(body.provider, "linkup-search");
    assert.equal(body.query, "omniroute linkup");
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].title, "Linkup result");
    assert.equal(body.results[0].snippet, "Linkup snippet");
    assert.equal(body.results[0].citation.provider, "linkup-search");
    assert.equal(body.cached, false);
    assert.equal(body.usage.queries_used, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST explicit provider does not fallback by default", async () => {
  await seedConnection("exa-search", { apiKey: "exa-key" });
  await seedConnection("brave-search", { apiKey: "brave-key" });

  const originalFetch = globalThis.fetch;
  const capturedUrls: string[] = [];

  globalThis.fetch = async (url) => {
    capturedUrls.push(String(url));
    return new Response(JSON.stringify({ error: "temporary exa failure" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute explicit no fallback",
          provider: "exa-search",
          max_results: 1,
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 503);
    assert.equal(capturedUrls.length, 1);
    assert.equal(capturedUrls[0], "https://api.exa.ai/search");
    assert.match(JSON.stringify(body), /exa-search returned 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST uses shared Parallel credentials and returns normalized results", async () => {
  await seedConnection("parallel", { apiKey: "parallel-key" });

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (url, init = {}) => {
    capturedUrl = String(url);
    capturedInit = init;

    return new Response(
      JSON.stringify({
        results: [
          {
            title: "Parallel result",
            url: "https://example.com/parallel",
            publish_date: "2026-06-01",
            excerpts: ["Parallel snippet", "Parallel excerpt body"],
          },
          { title: "Missing URL", excerpts: ["drop me"] },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute parallel",
          provider: "parallel-search",
          max_results: 2,
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;
    const requestBody = JSON.parse(String(capturedInit?.body));

    assert.equal(response.status, 200);
    assert.equal(capturedUrl, "https://api.parallel.ai/v1/search");
    assert.equal((capturedInit?.headers as Record<string, string>)["x-api-key"], "parallel-key");
    assert.deepEqual(requestBody.search_queries, ["omniroute parallel"]);
    assert.equal(requestBody.objective, "omniroute parallel");
    assert.equal(body.provider, "parallel-search");
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].title, "Parallel result");
    assert.equal(body.results[0].snippet, "Parallel snippet\n\nParallel excerpt body");
    assert.equal(body.results[0].citation.provider, "parallel-search");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST uses Firecrawl credentials and returns normalized news results", async () => {
  await seedConnection("firecrawl", { apiKey: "firecrawl-key" });

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (url, init = {}) => {
    capturedUrl = String(url);
    capturedInit = init;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          news: [
            {
              title: "Firecrawl news",
              snippet: "Firecrawl snippet",
              url: "https://news.example.com/firecrawl",
              date: "2026-06-15",
              imageUrl: "https://news.example.com/image.png",
              markdown: "# Firecrawl news",
            },
            { title: "Missing URL", snippet: "drop me" },
          ],
        },
        creditsUsed: 2,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute firecrawl",
          provider: "firecrawl-search",
          max_results: 2,
          search_type: "news",
          time_range: "week",
          country: "us",
          content: { full_page: true, format: "markdown" },
          filters: { include_domains: ["news.example.com"] },
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;
    const requestBody = JSON.parse(String(capturedInit?.body));

    assert.equal(response.status, 200);
    assert.equal(capturedUrl, "https://api.firecrawl.dev/v2/search");
    assert.equal(
      (capturedInit?.headers as Record<string, string>).Authorization,
      "Bearer firecrawl-key"
    );
    assert.equal(requestBody.query, "omniroute firecrawl");
    assert.equal(requestBody.limit, 2);
    assert.deepEqual(requestBody.sources, ["news"]);
    assert.deepEqual(requestBody.includeDomains, ["news.example.com"]);
    assert.equal(requestBody.tbs, "qdr:w");
    assert.deepEqual(requestBody.scrapeOptions, { formats: [{ type: "markdown" }] });
    assert.equal(body.provider, "firecrawl-search");
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].title, "Firecrawl news");
    assert.equal(body.results[0].content.format, "markdown");
    assert.equal(body.results[0].citation.provider, "firecrawl-search");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST uses Gemini credentials and returns grounded results", async () => {
  await seedConnection("gemini", {
    apiKey: "gemini-key",
    providerSpecificData: { model: "gemini-test-model" },
  });

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (url, init = {}) => {
    capturedUrl = String(url);
    capturedInit = init;

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: "Grounded answer" }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://example.com/gemini", title: "Gemini source" } },
                { web: { uri: "https://example.com/gemini#duplicate", title: "Duplicate" } },
                { web: { uri: "not-a-url", title: "Drop" } },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "OpenAI official website",
          provider: "gemini-grounded-search",
          max_results: 5,
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;
    const requestBody = JSON.parse(String(capturedInit?.body));

    assert.equal(response.status, 200);
    assert.equal(
      capturedUrl,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent"
    );
    assert.equal((capturedInit?.headers as Record<string, string>)["x-goog-api-key"], "gemini-key");
    assert.deepEqual(requestBody.tools, [{ googleSearch: {} }]);
    assert.equal(body.provider, "gemini-grounded-search");
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].title, "Gemini source");
    assert.equal(body.results[0].citation.provider, "gemini-grounded-search");
    assert.equal(body.answer.text, "Grounded answer");
    assert.equal(body.answer.model, "gemini-test-model");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST uses firecrawl credentials for unified firecrawl search", async () => {
  await seedConnection("firecrawl", { apiKey: "fc-route-key" });

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (url, init = {}) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          web: [
            {
              title: "Firecrawl route hit",
              url: "https://example.com/fc",
              description: "From firecrawl via /v1/search",
            },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute firecrawl",
          provider: "firecrawl",
          max_results: 3,
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as {
      provider: string;
      results: Array<{ title: string; snippet: string }>;
      usage: { queries_used: number };
    };

    assert.equal(response.status, 200);
    assert.equal(capturedUrl, "https://api.firecrawl.dev/v2/search");
    assert.equal(
      (capturedInit?.headers as Record<string, string>).Authorization,
      "Bearer fc-route-key"
    );
    const requestBody = JSON.parse(String(capturedInit?.body || "{}"));
    assert.equal(requestBody.query, "omniroute firecrawl");
    assert.equal(requestBody.limit, 3);
    assert.deepEqual(requestBody.sources, ["web"]);
    assert.equal(body.provider, "firecrawl");
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].title, "Firecrawl route hit");
    assert.equal(body.results[0].snippet, "From firecrawl via /v1/search");
    assert.equal(body.usage.queries_used, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST uses stored You.com credentials and returns unified news results", async () => {
  await seedConnection("youcom-search", { apiKey: "you-key" });

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (url, init = {}) => {
    capturedUrl = String(url);
    capturedInit = init;

    return new Response(
      JSON.stringify({
        results: {
          web: [],
          news: [
            {
              title: "You.com news result",
              description: "Breaking update",
              page_age: "2026-04-23T12:00:00Z",
              url: "https://news.example.com/you",
              thumbnail_url: "https://news.example.com/thumb.png",
            },
          ],
        },
        metadata: { search_uuid: "uuid-1", latency: 0.42 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "latest ai regulation",
          provider: "youcom-search",
          max_results: 1,
          search_type: "news",
          time_range: "week",
          content: { full_page: true, format: "markdown" },
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;
    const url = new URL(capturedUrl);

    assert.equal(response.status, 200);
    assert.equal(url.origin + url.pathname, "https://ydc-index.io/v1/search");
    assert.equal(url.searchParams.get("query"), "latest ai regulation");
    assert.equal(url.searchParams.get("count"), "1");
    assert.equal(url.searchParams.get("freshness"), "week");
    assert.equal(url.searchParams.get("livecrawl"), "news");
    assert.equal(url.searchParams.get("livecrawl_formats"), "markdown");
    assert.equal((capturedInit?.headers as Record<string, string>)["X-API-Key"], "you-key");
    assert.equal(body.provider, "youcom-search");
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].title, "You.com news result");
    assert.equal(body.results[0].snippet, "Breaking update");
    assert.equal(body.results[0].citation.provider, "youcom-search");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST accepts authless SearXNG with provider_options baseUrl", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";

  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(
      JSON.stringify({
        results: [
          {
            title: "SearXNG result",
            url: "https://searx.example/result",
            content: "Self-hosted response",
            engines: ["duckduckgo"],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "self hosted meta search",
          provider: "searxng-search",
          search_type: "news",
          provider_options: {
            baseUrl: "http://127.0.0.1:9090/custom-search",
          },
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;

    assert.equal(response.status, 200);
    assert.equal(
      capturedUrl,
      "http://127.0.0.1:9090/custom-search/search?q=self+hosted+meta+search&format=json&categories=news"
    );
    assert.equal(body.provider, "searxng-search");
    assert.equal(body.results[0].title, "SearXNG result");
    assert.equal(body.results[0].citation.provider, "searxng-search");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST rejects authless SearXNG on the unconfigured catalog default base URL (#10976)", async () => {
  // #10976/#10981 (already merged on this base): the catalog-default
  // localhost:8888 always fails in Docker/K8s, so it's now skipped unless a
  // request/connection baseUrl override resolves it to a real URL. This
  // replaces the older "default URL is attempted as-is" expectation.
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  globalThis.fetch = async (url) => {
    fetchCalled = true;
    return new Response(
      JSON.stringify({
        results: [
          {
            title: "Default SearXNG result",
            url: "https://searx.example/default",
            content: "Default self-hosted response",
            engines: ["duckduckgo"],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "default self hosted meta search",
          provider: "searxng-search",
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;

    assert.equal(response.status, 503);
    assert.equal(fetchCalled, false);
    assert.match(String(body.error?.message ?? body.error ?? ""), /catalog default/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST preserves stored SearXNG baseUrl for authless providers", async () => {
  await seedConnection("searxng-search", {
    apiKey: null,
    authType: "none",
    providerSpecificData: {
      baseUrl: "http://127.0.0.1:9090/custom-search",
    },
  });

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";

  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(
      JSON.stringify({
        results: [
          {
            title: "Stored SearXNG result",
            url: "https://searx.example/stored",
            content: "Stored self-hosted response",
            engines: ["duckduckgo"],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "stored self hosted meta search",
          provider: "searxng-search",
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;

    assert.equal(response.status, 200);
    assert.equal(
      capturedUrl,
      "http://127.0.0.1:9090/custom-search/search?q=stored+self+hosted+meta+search&format=json&categories=general"
    );
    assert.equal(body.provider, "searxng-search");
    assert.equal(body.results[0].title, "Stored SearXNG result");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST falls back to duckduckgo-free when no provider is configured (#11097)", async () => {
  // Contract changed by PR #11097 ("fix(search): fall back to duckduckgo-free when
  // no search provider is configured"): zero-credential /v1/search no longer returns
  // 400 — it promotes the fallback-only duckduckgo-free provider so out-of-the-box
  // search works. This test pins the NEW contract.
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";

  // DuckDuckGo lite HTML shape: result link + snippet cell (see
  // open-sse/services/freeWebSearch.ts parseDuckDuckGoLite).
  const liteHtml = `<html><body>
    <a href="https://example.com/auto-result" class='result-link'>Auto-selected DuckDuckGo result</a>
    <td class='result-snippet'>Fallback free search snippet</td>
  </body></html>`;

  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(liteHtml, { status: 200, headers: { "content-type": "text/html" } });
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "auto select self hosted search",
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;

    assert.equal(response.status, 200);
    assert.equal(
      capturedUrl,
      "https://lite.duckduckgo.com/lite/",
      "the fallback must call the DuckDuckGo lite endpoint"
    );
    assert.equal(body.provider, "duckduckgo-free");
    assert.equal(body.results[0].title, "Auto-selected DuckDuckGo result");
    assert.equal(body.results[0].url, "https://example.com/auto-result");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST auto-select uses configured order and skips missing credentials", async () => {
  await seedConnection("tavily-search", { apiKey: "tavily-key" });
  await seedConnection("exa-search", { apiKey: "exa-key" });

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (url, init = {}) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(
      JSON.stringify({
        results: [{ title: "Tavily first configured", url: "https://example.com/tavily" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute configured order",
          max_results: 1,
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;

    assert.equal(response.status, 200);
    assert.equal(capturedUrl, "https://api.tavily.com/search");
    assert.equal(
      (capturedInit?.headers as Record<string, string>).Authorization,
      "Bearer tavily-key"
    );
    assert.equal(body.provider, "tavily-search");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST skips disabled auto provider but still allows it explicitly", async () => {
  await seedConnection("brave-search", { apiKey: "brave-key" });
  await seedConnection("tavily-search", { apiKey: "tavily-key" });
  await routingOverrides.saveRoutingOverride({
    endpoint: "search",
    order: ["brave-search", "tavily-search"],
    disabled: ["brave-search"],
  });

  const originalFetch = globalThis.fetch;
  const capturedUrls: string[] = [];

  globalThis.fetch = async (url) => {
    capturedUrls.push(String(url));
    if (String(url).includes("api.tavily.com")) {
      return new Response(
        JSON.stringify({
          results: [{ title: "Tavily result", url: "https://example.com/tavily" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        web: { results: [{ title: "Brave result", url: "https://example.com/brave" }] },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const autoResponse = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute disabled auto",
          max_results: 1,
          search_type: "web",
        }),
      })
    );
    const autoBody = (await autoResponse.json()) as SearchRouteResponse;

    assert.equal(autoResponse.status, 200);
    assert.equal(autoBody.provider, "tavily-search");
    assert.equal(capturedUrls[0], "https://api.tavily.com/search");

    const explicitResponse = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute explicit disabled",
          provider: "brave-search",
          max_results: 1,
          search_type: "web",
        }),
      })
    );
    const explicitBody = (await explicitResponse.json()) as SearchRouteResponse;

    assert.equal(explicitResponse.status, 200);
    assert.equal(explicitBody.provider, "brave-search");
    assert.equal(capturedUrls[1].startsWith("https://api.search.brave.com/"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST auto-select skips rate-limited first provider", async () => {
  await seedRateLimitedConnection("brave-search");
  await seedConnection("tavily-search", { apiKey: "tavily-key" });

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";

  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(
      JSON.stringify({
        results: [{ title: "Tavily after cooldown", url: "https://example.com/tavily-cooldown" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute cooldown skip",
          max_results: 1,
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;

    assert.equal(response.status, 200);
    assert.equal(capturedUrl, "https://api.tavily.com/search");
    assert.equal(body.provider, "tavily-search");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST preflight skips exhausted primary and fetches ordered fallback", async () => {
  const blocked = await seedPreflightConnection("brave-search", "brave-preflight-key");
  const fallback = await seedPreflightConnection("tavily-search", "tavily-preflight-key");
  await routingOverrides.saveRoutingOverride({
    endpoint: "search",
    order: ["brave-search", "tavily-search"],
    disabled: [
      "exa-search",
      "serper-search",
      "searchapi-search",
      "linkup-search",
      "searxng-search",
      "youcom-search",
      "ollama-search",
      "zai-search",
      "parallel-search",
      "firecrawl-search",
      "perplexity-search",
      "gemini-grounded-search",
    ],
  });

  quotaPreflight.registerQuotaFetcher("brave-search", async (connectionId) => ({
    used: connectionId === blocked.id ? 100 : 0,
    total: 100,
    percentUsed: connectionId === blocked.id ? 1 : 0,
    resetAt: connectionId === blocked.id ? new Date(Date.now() + 60_000).toISOString() : null,
  }));
  quotaPreflight.registerQuotaFetcher("tavily-search", async (connectionId) => ({
    used: connectionId === fallback.id ? 0 : 100,
    total: 100,
    percentUsed: connectionId === fallback.id ? 0 : 1,
    resetAt: null,
  }));

  const originalFetch = globalThis.fetch;
  const capturedUrls: string[] = [];
  globalThis.fetch = async (url) => {
    capturedUrls.push(String(url));
    return new Response(
      JSON.stringify({
        results: [{ title: "Tavily fallback", url: "https://example.com/fallback" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute preflight fallback",
          max_results: 1,
          search_type: "web",
        }),
      })
    );
    const body = (await response.json()) as SearchRouteResponse;

    assert.equal(response.status, 200);
    assert.deepEqual(capturedUrls, ["https://api.tavily.com/search"]);
    assert.equal(body.provider, "tavily-search");
    assert.equal(body.results[0].title, "Tavily fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST explicit preflight exhaustion returns rate-limit metadata", async () => {
  const blocked = await seedPreflightConnection("brave-search", "brave-explicit-blocked");
  await seedConnection("tavily-search", { apiKey: "tavily-must-not-run" });
  quotaPreflight.registerQuotaFetcher("brave-search", async (connectionId) => ({
    used: 100,
    total: 100,
    percentUsed: connectionId === blocked.id ? 1 : 0,
    resetAt: new Date(Date.now() + 60_000).toISOString(),
  }));

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };

  try {
    const response = await searchRoute.POST(
      new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "omniroute explicit preflight",
          provider: "brave-search",
          max_results: 1,
          search_type: "web",
        }),
      })
    );

    assert.equal(response.status, 429);
    assert.equal(fetchCalls, 0);
    assert.ok(response.headers.get("Retry-After"));
    assert.match(JSON.stringify(await response.json()), /All accounts rate limited/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("v1 search POST all preflight candidates returns first blocked provider metadata", async () => {
  const brave = await seedPreflightConnection("brave-search", "brave-all-blocked");
  const tavily = await seedPreflightConnection("tavily-search", "tavily-all-blocked");
  await routingOverrides.saveRoutingOverride({
    endpoint: "search",
    order: ["brave-search", "tavily-search"],
    disabled: [
      "exa-search",
      "serper-search",
      "searchapi-search",
      "linkup-search",
      "searxng-search",
      "youcom-search",
      "ollama-search",
      "zai-search",
      "parallel-search",
      "firecrawl-search",
      "perplexity-search",
      "gemini-grounded-search",
    ],
  });
  const retryAfter = new Date(Date.now() + 60_000).toISOString();
  quotaPreflight.registerQuotaFetcher("brave-search", async () => ({
    used: 100,
    total: 100,
    percentUsed: 1,
    resetAt: retryAfter,
  }));
  quotaPreflight.registerQuotaFetcher("tavily-search", async () => ({
    used: 100,
    total: 100,
    percentUsed: 1,
    resetAt: retryAfter,
  }));

  const response = await searchRoute.POST(
    new Request("http://localhost/api/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "omniroute all preflight blocked",
        max_results: 1,
        search_type: "web",
      }),
    })
  );

  assert.equal(response.status, 429);
  assert.ok(response.headers.get("Retry-After"));
  assert.match(JSON.stringify(await response.json()), /brave-search/);
  assert.ok(brave.id);
  assert.ok(tavily.id);
});
