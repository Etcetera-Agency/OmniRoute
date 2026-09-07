import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-web-fetch-fallback-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const routingOverrides = await import("../../src/lib/routing/routingOverrides.ts");
const webFetchRoute = await import("../../src/app/api/v1/web/fetch/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function seedConnection(
  provider: string,
  overrides: {
    apiKey?: string | null;
    rateLimitedUntil?: string | null;
    providerSpecificData?: Record<string, unknown>;
  } = {}
) {
  return providersDb.createProviderConnection({
    provider,
    authType: "apikey",
    name: `${provider}-${Math.random().toString(16).slice(2, 8)}`,
    apiKey: overrides.apiKey ?? "test-key",
    isActive: true,
    testStatus: "active",
    rateLimitedUntil: overrides.rateLimitedUntil ?? null,
    providerSpecificData: overrides.providerSpecificData ?? {},
  });
}

function postWebFetch(body: Record<string, unknown>) {
  return webFetchRoute.POST(
    new Request("http://localhost/api/v1/web/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", ...body }),
    })
  );
}

interface WebFetchTestBody {
  provider?: string;
  content?: string;
  error?: { message: string };
}

async function readJson(response: Response): Promise<WebFetchTestBody> {
  return (await response.json()) as WebFetchTestBody;
}

const FUTURE_ISO = new Date(Date.now() + 5 * 60 * 1000).toISOString();

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ── (a) credential-time: rate-limited stub is skipped, not short-circuited ──

test("auto-select skips a rate-limited firecrawl and falls to jina-reader", async () => {
  await seedConnection("firecrawl", { rateLimitedUntil: FUTURE_ISO });
  await seedConnection("jina-reader", { apiKey: "jina-key" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.firecrawl.dev")) {
      throw new Error("firecrawl should never be called once rate-limited");
    }
    if (u.includes("r.jina.ai")) {
      return new Response(JSON.stringify({ data: { content: "jina content", links: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${u}`);
  };

  try {
    const response = await postWebFetch({});
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.provider, "jina-reader");
    assert.equal(body.content, "jina content");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auto-select skips a preflight-blocked firecrawl and falls to jina-reader", async () => {
  const blocked = await seedConnection("firecrawl", {
    providerSpecificData: { quotaPreflightEnabled: true },
  });
  await seedConnection("jina-reader", { apiKey: "jina-key" });
  await routingOverrides.saveRoutingOverride({
    endpoint: "fetch",
    order: ["firecrawl", "jina-reader"],
  });

  const quotaPreflight = await import("../../open-sse/services/quotaPreflight.ts");
  quotaPreflight.registerQuotaFetcher("firecrawl", async (connectionId) => ({
    used: connectionId === blocked.id ? 100 : 0,
    total: 100,
    percentUsed: connectionId === blocked.id ? 1 : 0,
    resetAt: connectionId === blocked.id ? FUTURE_ISO : null,
  }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    assert.equal(u.includes("api.firecrawl.dev"), false, "preflight block must prevent fetch");
    if (u.includes("r.jina.ai")) {
      return new Response(JSON.stringify({ data: { content: "jina content", links: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${u}`);
  };

  try {
    const response = await postWebFetch({});
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.provider, "jina-reader");
  } finally {
    globalThis.fetch = originalFetch;
    await routingOverrides.resetRoutingOverride("fetch");
  }
});

test("auto-select returns one 429 when the only compatible provider is preflight-blocked", async () => {
  const blocked = await seedConnection("firecrawl", {
    providerSpecificData: { quotaPreflightEnabled: true },
  });
  await routingOverrides.saveRoutingOverride({ endpoint: "fetch", order: ["firecrawl"] });

  const quotaPreflight = await import("../../open-sse/services/quotaPreflight.ts");
  quotaPreflight.registerQuotaFetcher("firecrawl", async (connectionId) => ({
    used: connectionId === blocked.id ? 100 : 0,
    total: 100,
    percentUsed: connectionId === blocked.id ? 1 : 0,
    resetAt: connectionId === blocked.id ? FUTURE_ISO : null,
  }));

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("preflight-blocked Firecrawl must not be fetched");
  };

  try {
    const response = await postWebFetch({ format: "screenshot" });
    const body = await readJson(response);

    assert.equal(response.status, 429);
    assert.equal(fetchCalled, false);
    assert.ok(response.headers.get("Retry-After"), "should include a Retry-After header");
    assert.ok((body.error?.message ?? "").includes("quota preflight"));
  } finally {
    globalThis.fetch = originalFetch;
    await routingOverrides.resetRoutingOverride("fetch");
  }
});

// ── (b) request-time: credentialed provider returns 429 → falls through ────

test("auto-select falls through to jina-reader when firecrawl returns 429 at request time", async () => {
  await seedConnection("firecrawl", { apiKey: "fc-key" });
  await seedConnection("jina-reader", { apiKey: "jina-key" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.firecrawl.dev")) {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("r.jina.ai")) {
      return new Response(JSON.stringify({ data: { content: "jina content", links: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${u}`);
  };

  try {
    const response = await postWebFetch({});
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.provider, "jina-reader");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── (c) provider-specific quota status (402/403) triggers fallback; plain 400 does NOT ──

test("auto-select falls through to jina-reader when firecrawl returns 403 (quota-style)", async () => {
  await seedConnection("firecrawl", { apiKey: "fc-key" });
  await seedConnection("jina-reader", { apiKey: "jina-key" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.firecrawl.dev")) {
      return new Response(JSON.stringify({ error: "quota exceeded" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("r.jina.ai")) {
      return new Response(JSON.stringify({ data: { content: "jina content", links: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${u}`);
  };

  try {
    const response = await postWebFetch({});
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.provider, "jina-reader");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auto-select does not fall through when jina-reader returns non-quota 403", async () => {
  await seedConnection("jina-reader", { apiKey: "jina-key" });
  await seedConnection("firecrawl", { apiKey: "fc-key" });
  await routingOverrides.saveRoutingOverride({
    endpoint: "fetch",
    order: ["jina-reader", "firecrawl"],
  });

  let firecrawlWasCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("r.jina.ai")) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }
    if (target.includes("api.firecrawl.dev")) {
      firecrawlWasCalled = true;
      return new Response(JSON.stringify({ data: { markdown: "unexpected fallback" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${target}`);
  };

  try {
    const response = await postWebFetch({});

    assert.equal(response.status, 403);
    assert.equal(firecrawlWasCalled, false, "non-quota 403 must not trigger fallback");
  } finally {
    globalThis.fetch = originalFetch;
    await routingOverrides.resetRoutingOverride("fetch");
  }
});

test("auto-select does NOT fall through when firecrawl returns a plain 400 bad request", async () => {
  await seedConnection("firecrawl", { apiKey: "fc-key" });
  await seedConnection("jina-reader", { apiKey: "jina-key" });
  await routingOverrides.saveRoutingOverride({
    endpoint: "fetch",
    order: ["firecrawl", "jina-reader"],
  });

  let jinaWasCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.firecrawl.dev")) {
      return new Response(JSON.stringify({ error: "bad url" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("r.jina.ai")) {
      jinaWasCalled = true;
      return new Response(JSON.stringify({ data: { content: "jina content", links: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${u}`);
  };

  try {
    const response = await postWebFetch({});
    const body = await readJson(response);

    assert.equal(response.status, 400);
    assert.equal(jinaWasCalled, false, "jina-reader must not be tried for a non-quota 400");
    assert.ok(!(body.error?.message ?? "").includes("at /"), "error must not leak stack paths");
  } finally {
    globalThis.fetch = originalFetch;
    await routingOverrides.resetRoutingOverride("fetch");
  }
});

test("auto-select preserves fallback for a generic provider auth failure", async () => {
  await seedConnection("jina-reader", { apiKey: "jina-key" });
  await seedConnection("firecrawl", { apiKey: "fc-key" });
  await routingOverrides.saveRoutingOverride({
    endpoint: "fetch",
    order: ["jina-reader", "firecrawl"],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("r.jina.ai")) {
      return new Response(JSON.stringify({ error: "invalid key" }), { status: 401 });
    }
    if (target.includes("api.firecrawl.dev")) {
      return new Response(JSON.stringify({ data: { markdown: "# Firecrawl fallback" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${target}`);
  };

  try {
    const response = await postWebFetch({});
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.provider, "firecrawl");
    assert.equal(body.content, "# Firecrawl fallback");
  } finally {
    globalThis.fetch = originalFetch;
    await routingOverrides.resetRoutingOverride("fetch");
  }
});

// ── (d) explicit rate-limited provider → 429, no silent fallback ───────────

test("explicit rate-limited provider request returns 429 without falling back", async () => {
  await seedConnection("firecrawl", { rateLimitedUntil: FUTURE_ISO });
  await seedConnection("jina-reader", { apiKey: "jina-key" });

  let jinaWasCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("r.jina.ai")) {
      jinaWasCalled = true;
    }
    throw new Error(`unexpected fetch to ${u}`);
  };

  try {
    const response = await postWebFetch({ provider: "firecrawl" });
    const body = await readJson(response);

    assert.equal(response.status, 429);
    assert.equal(jinaWasCalled, false, "explicit provider request must never fall back");
    assert.ok(response.headers.get("Retry-After"), "should include a Retry-After header");
    assert.ok(!(body.error?.message ?? "").includes("at /"), "error must not leak stack paths");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit provider falls back only when fallback=true", async () => {
  await seedConnection("firecrawl", { apiKey: "fc-key" });
  await seedConnection("jina-reader", { apiKey: "jina-key" });
  await routingOverrides.saveRoutingOverride({
    endpoint: "fetch",
    order: ["firecrawl", "jina-reader"],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.firecrawl.dev")) {
      return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
    }
    if (u.includes("r.jina.ai")) {
      return new Response(JSON.stringify({ data: { content: "jina content", links: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${u}`);
  };

  try {
    const response = await postWebFetch({ provider: "firecrawl", fallback: true });
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.provider, "jina-reader");
  } finally {
    globalThis.fetch = originalFetch;
    await routingOverrides.resetRoutingOverride("fetch");
  }
});

test("explicit provider with missing credentials can reach fallback=true chain", async () => {
  await routingOverrides.saveRoutingOverride({
    endpoint: "fetch",
    order: ["firecrawl", "mdream"],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).startsWith("https://mdream.dev/"));
    return new Response("# Mdream fallback", {
      status: 200,
      headers: { "content-type": "text/markdown" },
    });
  };

  try {
    const response = await postWebFetch({ provider: "firecrawl", fallback: true });
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.provider, "mdream");
    assert.equal(body.content, "# Mdream fallback");
  } finally {
    globalThis.fetch = originalFetch;
    await routingOverrides.resetRoutingOverride("fetch");
  }
});

test("web fetch Retry-After treats numeric epoch milliseconds as an absolute reset", () => {
  const retryAt = Date.now() + 30_000;
  const retryAfter = Number(webFetchRoute.toRetryAfterSeconds(retryAt));

  assert.ok(retryAfter >= 1 && retryAfter <= 30);
});

// ── (e) whole pool exhausted at request time → single 429 with retry-after ─

test("auto-select returns a single 429 with retry-after when the whole pool is exhausted", async () => {
  await seedConnection("firecrawl", { apiKey: "fc-key" });
  await seedConnection("jina-reader", { apiKey: "jina-key" });
  await seedConnection("tavily-search", { apiKey: "tavily-key" });
  await seedConnection("tinyfish", { apiKey: "tf-key" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await postWebFetch({});
    const body = await readJson(response);

    assert.equal(response.status, 429);
    assert.ok(response.headers.get("Retry-After"), "should include a Retry-After header");
    assert.ok(!(body.error?.message ?? "").includes("at /"), "error must not leak stack paths");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auto-select normalizes a sole quota-style 402 to a retryable 429", async () => {
  await seedConnection("firecrawl", { apiKey: "fc-key" });
  await routingOverrides.saveRoutingOverride({ endpoint: "fetch", order: ["firecrawl"] });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: "quota exhausted" }), {
      status: 402,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await postWebFetch({ format: "screenshot" });
    const body = await readJson(response);

    assert.equal(response.status, 429);
    assert.ok(response.headers.get("Retry-After"), "should include a Retry-After header");
    assert.ok((body.error?.message ?? "").includes("quota exhausted"));
  } finally {
    globalThis.fetch = originalFetch;
    await routingOverrides.resetRoutingOverride("fetch");
  }
});

// ── Mdream stays first, keyless, and eligible in automatic mode ────────────

test("auto-select uses keyless mdream when no credentialed provider is configured", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).startsWith("https://mdream.dev/"));
    return new Response("# Mdream content", {
      status: 200,
      headers: { "content-type": "text/markdown" },
    });
  };

  try {
    const response = await postWebFetch({});
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.provider, "mdream");
    assert.equal(body.content, "# Mdream content");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
