import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-web-fetch-handler-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { handleWebFetch } = await import("../../open-sse/handlers/webFetch.ts");
const routingOverrides = await import("../../src/lib/routing/routingOverrides.ts");
const mdream = await import("../../open-sse/executors/mdream-fetch.ts");
const parallel = await import("../../open-sse/executors/parallel-extract.ts");

test.beforeEach(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

// ── handleWebFetch — basic routing ───────────────────────────────────────────

test("handleWebFetch routes to firecrawl when provider=firecrawl", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        data: {
          markdown: "# Hello World",
          links: ["https://example.com/page"],
          metadata: { title: "Hello", description: "A test page" },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await handleWebFetch(
      { url: "https://example.com", format: "markdown" },
      { apiKey: "test-key" },
      "firecrawl"
    );

    assert.equal(result.success, true, "should succeed");
    assert.ok(result.data, "should have data");
    assert.equal(result.data.provider, "firecrawl");
    assert.equal(result.data.url, "https://example.com");
    assert.ok(typeof result.data.content === "string", "content should be string");
    assert.ok(Array.isArray(result.data.links), "links should be array");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleWebFetch routes to jina-reader when provider=jina-reader", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        data: {
          content: "# Jina content",
          title: "Test",
          description: "desc",
          links: [],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await handleWebFetch(
      { url: "https://example.com", format: "markdown" },
      { apiKey: "jina-key" },
      "jina-reader"
    );

    assert.equal(result.success, true);
    assert.equal(result.data?.provider, "jina-reader");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleWebFetch routes to tinyfish when provider=tinyfish", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        results: [{ url: "https://example.com", title: "Test", text: "# TinyFish content" }],
        errors: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await handleWebFetch(
      { url: "https://example.com", format: "markdown" },
      { apiKey: "tf-key" },
      "tinyfish"
    );

    assert.equal(result.success, true);
    assert.equal(result.data?.provider, "tinyfish");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleWebFetch returns error 401 when no apiKey for firecrawl", async () => {
  const result = await handleWebFetch({ url: "https://example.com" }, {}, "firecrawl");

  assert.equal(result.success, false);
  assert.equal(result.status, 401);
  assert.ok(result.error, "should have error message");
  // Error must not expose stack traces
  assert.ok(!result.error.includes("at /"), "error must not contain stack trace paths");
});

test("handleWebFetch returns error 401 when no apiKey for jina-reader", async () => {
  const result = await handleWebFetch({ url: "https://example.com" }, {}, "jina-reader");

  assert.equal(result.success, false);
  assert.equal(result.status, 401);
  assert.ok(!result.error?.includes("at /"), "error must not contain stack trace paths");
});

test("handleWebFetch wraps fetch errors via buildErrorBody (no raw stack)", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error("at /internal/path/executor.ts:42:10\nnetwork failure");
  };

  try {
    const result = await handleWebFetch(
      { url: "https://example.com" },
      { apiKey: "test-key" },
      "firecrawl"
    );

    assert.equal(result.success, false);
    assert.ok(result.status != null, "should have status");
    // Stack trace must be stripped
    assert.ok(!result.error?.includes("at /"), "error must not contain stack trace paths");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleWebFetch passes depth and wait_for_selector to firecrawl", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { body: Record<string, unknown> } = { body: {} };

  globalThis.fetch = async (_url, init) => {
    captured.body = JSON.parse(String((init as RequestInit).body ?? "{}"));
    return new Response(JSON.stringify({ data: { markdown: "" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handleWebFetch(
      { url: "https://example.com", depth: 2, wait_for_selector: "main" },
      { apiKey: "test-key" },
      "firecrawl"
    );

    assert.equal(captured.body.maxDepth, 2, "should forward depth");
    assert.equal(captured.body.waitFor, "main", "should forward wait_for_selector");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleWebFetch lets Mdream handle Bearer-authenticated gateway requests", async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Headers | null = null;

  globalThis.fetch = async (_url, init) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response("# Example", {
      status: 200,
      headers: { "content-type": "text/markdown" },
    });
  };

  try {
    const result = await handleWebFetch(
      {
        url: "https://example.com",
        headers: new Headers({ Authorization: "Bearer omni-key" }),
      },
      {},
      "mdream"
    );

    assert.equal(result.success, true);
    assert.equal(result.data?.provider, "mdream");
    assert.equal(capturedHeaders?.get("authorization"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mdreamFetch builds verified raw Mdream URL and rejects secret query params", async () => {
  assert.equal(
    mdream.buildMdreamFetchUrl("https://example.com/path?a=1"),
    "https://mdream.dev/example.com/path?a=1"
  );

  const result = await mdream.mdreamFetch({
    url: "https://example.com/callback?token=secret",
    format: "markdown",
    includeMetadata: false,
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 400);
  assert.ok(result.error?.includes("secret-bearing"));
});

test("mdreamFetch blocks private, authorized, cookie-bearing, and sensitive-health URLs", async () => {
  const cases = [
    {
      name: "localhost",
      options: { url: "http://localhost:3000/private", format: "markdown" as const },
      expected: /Blocked private|local provider URL/,
    },
    {
      name: "private ip",
      options: { url: "http://192.168.0.2/private", format: "markdown" as const },
      expected: /Blocked private|local provider URL/,
    },
    {
      name: "authorization",
      options: {
        url: "https://example.com/private",
        format: "markdown" as const,
        headers: new Headers({ Authorization: "Bearer secret" }),
      },
      expected: /authorized|cookie-bearing/,
    },
    {
      name: "cookie",
      options: {
        url: "https://example.com/private",
        format: "markdown" as const,
        headers: new Headers({ Cookie: "session=secret" }),
      },
      expected: /authorized|cookie-bearing/,
    },
    {
      name: "sensitive-health",
      options: {
        url: "https://example.com/private",
        format: "markdown" as const,
        headers: new Headers({ "x-hermes-data-class": "sensitive-health" }),
      },
      expected: /sensitive-health/,
    },
  ];

  for (const item of cases) {
    const result = await mdream.mdreamFetch({
      includeMetadata: false,
      ...item.options,
    });
    assert.equal(result.success, false, `${item.name} should fail`);
    assert.match(result.error ?? "", item.expected, `${item.name} error should match`);
  }
});

test("parallelExtract sends current Parallel v1 extract request and normalizes excerpts", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;

  globalThis.fetch = async (url, init) => {
    captured = {
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")),
    };
    return new Response(
      JSON.stringify({
        results: [
          {
            url: "https://example.com",
            title: "Example",
            excerpts: ["# Example", "Body"],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await parallel.parallelExtractFetch({
      url: "https://example.com",
      format: "markdown",
      includeMetadata: true,
      credentials: { apiKey: "parallel-key" },
    });

    assert.equal(result.success, true);
    assert.equal(result.data?.provider, "parallel-extract");
    assert.equal(result.data?.content, "# Example\n\nBody");
    assert.equal(captured?.url, "https://api.parallel.ai/v1/extract");
    assert.equal(captured?.headers.get("x-api-key"), "parallel-key");
    assert.deepEqual(captured?.body.urls, ["https://example.com"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleWebFetch auto fallback tries mdream then parallel-extract", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).startsWith("https://mdream.dev/")) {
      return new Response("", { status: 200 });
    }
    return new Response(
      JSON.stringify({
        results: [{ url: "https://example.com", excerpts: ["Parallel content"] }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await handleWebFetch(
      { url: "https://example.com", format: "markdown" },
      { providerCredentials: { "parallel-extract": { apiKey: "parallel-key" } } }
    );

    assert.equal(result.success, true);
    assert.equal(result.data?.provider, "parallel-extract");
    assert.ok(urls[0].startsWith("https://mdream.dev/"));
    assert.equal(urls[1], "https://api.parallel.ai/v1/extract");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleWebFetch skips disabled auto provider but still allows it explicitly", async () => {
  await routingOverrides.saveRoutingOverride({
    endpoint: "fetch",
    order: ["mdream", "parallel-extract"],
    disabled: ["mdream"],
  });

  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).startsWith("https://api.parallel.ai/")) {
      return new Response(
        JSON.stringify({
          results: [{ url: "https://example.com", excerpts: ["Parallel content"] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response("# Mdream content", {
      status: 200,
      headers: { "content-type": "text/markdown" },
    });
  };

  try {
    const autoResult = await handleWebFetch(
      { url: "https://example.com", format: "markdown" },
      { providerCredentials: { "parallel-extract": { apiKey: "parallel-key" } } }
    );

    assert.equal(autoResult.success, true);
    assert.equal(autoResult.data?.provider, "parallel-extract");
    assert.equal(urls[0], "https://api.parallel.ai/v1/extract");

    const explicitResult = await handleWebFetch(
      { url: "https://example.com", provider: "mdream", format: "markdown" },
      { providerCredentials: { "parallel-extract": { apiKey: "parallel-key" } } }
    );

    assert.equal(explicitResult.success, true);
    assert.equal(explicitResult.data?.provider, "mdream");
    assert.ok(urls[1].startsWith("https://mdream.dev/"));
  } finally {
    globalThis.fetch = originalFetch;
    await routingOverrides.resetRoutingOverride("fetch");
  }
});

test("handleWebFetch attempt telemetry stores host without secret URL", async () => {
  const attempts: unknown[] = [];

  const result = await handleWebFetch(
    {
      url: "https://example.com/callback?api_key=secret",
      provider: "mdream",
      format: "markdown",
      log: {
        info(_tag, _message, data) {
          attempts.push(data);
        },
      },
    },
    {}
  );

  assert.equal(result.success, false);
  assert.equal(attempts.length, 1);
  const attempt = attempts[0] as { latencyMs: number };
  assert.deepEqual(attempts[0], {
    provider: "mdream",
    format: "markdown",
    success: false,
    status: 400,
    latencyMs: attempt.latencyMs,
    contentBytes: 0,
    fallbackReason: result.error,
    fallback: false,
    urlHost: "example.com",
  });
  assert.ok(attempt.latencyMs >= 0);
  assert.equal(JSON.stringify(attempts).includes("api_key=secret"), false);
});
