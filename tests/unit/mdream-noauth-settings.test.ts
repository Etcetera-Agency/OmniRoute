import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdream-noauth-"));
process.env.DATA_DIR = dataDir;
process.env.REQUIRE_API_KEY = "false";
const core = await import("../../src/lib/db/core.ts");
const settings = await import("../../src/lib/db/settings.ts");
const route = await import("../../src/app/api/v1/web/fetch/route.ts");
const proxies = await import("../../src/lib/db/proxies.ts");

function request() {
  return new Request("http://localhost/api/v1/web/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mdream", format: "markdown", url: "https://example.com/" }),
  });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("Mdream uses the standard no-auth registry with a Web Fetch playground", async () => {
  const providers = await import("../../src/shared/constants/providers.ts");
  assert.equal(providers.NOAUTH_PROVIDERS.mdream.noAuth, true);
  assert.deepEqual(providers.AI_PROVIDERS.mdream.serviceKinds, ["webFetch"]);
  assert.equal(providers.supportsNoAuthProviderProxy("mdream"), true);
});

test("no-auth provider disable blocks Mdream without an upstream request", async () => {
  await settings.updateSettings({ blockedProviders: ["mdream"] });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("unexpected");
  };
  try {
    const response = await route.POST(request());
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Mdream outbound traffic uses the configured provider proxy", async () => {
  await settings.updateSettings({ blockedProviders: [] });
  const requests: string[] = [];
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      requests.push(chunk.toString("utf8"));
      socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await settings.setProxyForLevel("provider", "mdream", {
    type: "http",
    host: "127.0.0.1",
    port: address.port,
  });
  try {
    const response = await route.POST(request());
    assert.ok(response.status >= 500);
    assert.ok(
      requests.some((line) => line.startsWith("CONNECT mdream.dev:443 ")),
      "Mdream request must reach the assigned proxy"
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("an unavailable assigned proxy fails closed without direct egress", async () => {
  await settings.deleteProxyForLevel("provider", "mdream");
  await proxies.createProxyAndAssign(
    { name: "inactive test proxy", type: "http", host: "127.0.0.1", port: 1, status: "inactive" },
    { scope: "provider", scopeId: "mdream" }
  );
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("direct egress was attempted");
  };
  try {
    const response = await route.POST(request());
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an unavailable provider proxy cannot fall back to a global proxy", async () => {
  const server = net.createServer((socket) => {
    socket.on("data", () => socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await proxies.createProxyAndAssign(
    {
      name: "global test proxy",
      type: "http",
      host: "127.0.0.1",
      port: address.port,
      status: "active",
    },
    { scope: "global" }
  );
  try {
    const response = await route.POST(request());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error.message, /Assigned provider proxy is unavailable/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
