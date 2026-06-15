import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-web-fetch-route-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.REQUIRE_API_KEY = "false";
process.env.INITIAL_PASSWORD = "";
process.env.DASHBOARD_PASSWORD = "";

const route = await import("../../src/app/api/v1/web/fetch/route.ts");

function buildPost(body: Record<string, unknown>, headers?: HeadersInit): Request {
  return new Request("http://localhost/api/v1/web/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("POST /v1/web/fetch routes explicit mdream request without credentials", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    requestedUrls.push(url);
    return new Response("# Example Domain\n\nFetched by Mdream", {
      status: 200,
      headers: { "Content-Type": "text/markdown" },
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await route.POST(
    buildPost({
      url: "https://example.com/docs?view=reader",
      provider: "mdream",
      format: "markdown",
      include_metadata: true,
    })
  );

  assert.equal(response.status, 200);
  assert.equal(requestedUrls[0], "https://mdream.dev/example.com/docs?view=reader");

  const body = await response.json();
  assert.equal(body.provider, "mdream");
  assert.equal(body.url, "https://example.com/docs?view=reader");
  assert.match(body.content, /Fetched by Mdream/);
  assert.deepEqual(body.metadata, { title: null, description: null });
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
});
