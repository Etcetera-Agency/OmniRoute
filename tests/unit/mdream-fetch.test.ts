import test from "node:test";
import assert from "node:assert/strict";

const { mdreamFetch } = await import("../../open-sse/executors/mdream-fetch.ts");

test("mdreamFetch rejects non-Markdown formats before upstream I/O", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("unexpected");
  };

  try {
    const result = await mdreamFetch({ url: "https://example.com", format: "html" });
    assert.equal(result.success, false);
    assert.equal(result.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mdreamFetch sends the working hosted request headers and clears its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  let requestUrl: URL | undefined;
  let requestHeaders: HeadersInit | undefined;
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = async (input, init = {}) => {
    requestUrl = new URL(String(input));
    requestHeaders = init.headers;
    requestSignal = init.signal ?? undefined;
    return new Response("  # Example\n");
  };

  try {
    const result = await mdreamFetch({
      url: "https://example.com/docs?q=hello#part",
      format: "markdown",
      includeMetadata: true,
    });

    assert.equal(result.success, true);
    assert.equal(requestUrl?.toString(), "https://mdream.dev/example.com/docs?q=hello");
    assert.deepEqual(requestHeaders, {
      Accept: "text/markdown, text/plain;q=0.9",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://mdream.dev/",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Upgrade-Insecure-Requests": "1",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    assert.equal(requestSignal?.aborted, false);
    t.mock.timers.tick(20_000);
    assert.equal(requestSignal?.aborted, false);
    assert.deepEqual(result.data, {
      provider: "mdream",
      url: "https://example.com/docs?q=hello#part",
      content: "# Example",
      links: [],
      metadata: { title: null, description: null },
      screenshot_url: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mdreamFetch rejects unsafe and non-HTTPS target URLs before upstream I/O", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("unexpected");
  };

  try {
    for (const url of [
      "http://example.com/",
      "https://localhost/",
      "https://127.0.0.1/",
      "https://user:secret@example.com/",
      "https://example.com/?API_KEY=private",
    ]) {
      const result = await mdreamFetch({ url, format: "markdown" });
      assert.equal(result.success, false, url);
      assert.equal(result.status, 400, url);
      assert.ok(!result.error?.includes(url), "error must not echo rejected URL");
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mdreamFetch maps upstream failures without exposing response bodies", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("secret upstream body", { status: 503 });

  try {
    const result = await mdreamFetch({ url: "https://example.com", format: "markdown" });
    assert.equal(result.success, false);
    assert.equal(result.status, 503);
    assert.ok(!result.error?.includes("secret upstream body"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mdreamFetch rejects empty content and sanitizes network failures", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response(" \n ", { status: 200 });
    const empty = await mdreamFetch({ url: "https://example.com", format: "markdown" });
    assert.equal(empty.success, false);
    assert.equal(empty.status, 502);

    globalThis.fetch = async () => {
      throw new Error("network failure");
    };
    const network = await mdreamFetch({ url: "https://example.com", format: "markdown" });
    assert.equal(network.success, false);
    assert.equal(network.status, 502);
    assert.ok(!network.error?.includes("https://example.com"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mdreamFetch maps response-body read failures to a sanitized 502", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("sensitive body read failure"));
        },
      })
    );

  try {
    const result = await mdreamFetch({ url: "https://example.com", format: "markdown" });
    assert.equal(result.success, false);
    assert.equal(result.status, 502);
    assert.ok(!result.error?.includes("sensitive body read failure"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mdreamFetch maps its abort deadline to a sanitized 504", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = async (_input, init = {}) => {
    requestSignal = init.signal ?? undefined;
    return new Promise((_resolve, reject) => {
      requestSignal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true }
      );
    });
  };

  try {
    const resultPromise = mdreamFetch({ url: "https://example.com", format: "markdown" });
    t.mock.timers.tick(20_000);
    const result = await resultPromise;
    assert.equal(result.success, false);
    assert.equal(result.status, 504);
    assert.equal(requestSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Mdream REST schema accepts provider id without adding endpoint modes", async () => {
  const { v1WebFetchSchema } = await import("../../src/shared/validation/schemas/apiV1.ts");
  const parsed = v1WebFetchSchema.safeParse({ url: "https://example.com", provider: "mdream" });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.format, "markdown");
});
