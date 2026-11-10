import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdream-retry-"));
process.env.DATA_DIR = dataDir;
process.env.REQUIRE_API_KEY = "false";
process.env.JWT_SECRET = "mdream-retry-test-secret";
const core = await import("../../src/lib/db/core.ts");
const settings = await import("../../src/lib/db/settings.ts");
const { clearAllModelLockouts, lockModel } =
  await import("../../open-sse/services/accountFallback.ts");
const route = await import("../../src/app/api/v1/web/fetch/route.ts");
const dashboard = await import("../../src/app/api/search/fetch/route.ts");
const session = await import("../../src/shared/utils/dashboardSessionToken.ts");
function request() {
  return new Request("http://localhost/api/v1/web/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mdream", format: "markdown", url: "https://example.com/" }),
  });
}
test.after(() => {
  clearAllModelLockouts();
  core.resetDbInstance();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("configured retry delay blocks repeated 429 traffic and permits recovery", async () => {
  await settings.updateSettings({
    resilienceSettings: { providerQuotaOverrides: { mdream: { rateLimitCooldownSeconds: 15 } } },
  });
  const originalFetch = globalThis.fetch,
    originalNow = Date.now;
  let now = originalNow(),
    upstreamCalls = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {
    upstreamCalls++;
    return upstreamCalls === 1
      ? new Response("rate limited", { status: 429 })
      : new Response("# Example Domain");
  };
  try {
    assert.equal((await route.POST(request())).status, 429);
    const blocked = await route.POST(request());
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "15");
    assert.equal(upstreamCalls, 1);
    now += 15001;
    const recovered = await route.POST(request());
    assert.equal(recovered.status, 200);
    assert.equal(upstreamCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    clearAllModelLockouts();
  }
});

test("upstream Retry-After takes precedence over configured retry delay", async () => {
  await settings.updateSettings({
    resilienceSettings: { providerQuotaOverrides: { mdream: { rateLimitCooldownSeconds: 15 } } },
  });
  const originalFetch = globalThis.fetch,
    originalNow = Date.now;
  let now = originalNow(),
    upstreamCalls = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {
    upstreamCalls++;
    return upstreamCalls === 1
      ? new Response("rate limited", { status: 429, headers: { "retry-after": "2" } })
      : new Response("# Example Domain");
  };
  try {
    const first = await route.POST(request());
    assert.equal(first.status, 429);
    assert.equal(first.headers.get("retry-after"), "2");
    const blocked = await route.POST(request());
    assert.equal(blocked.headers.get("retry-after"), "2");
    assert.equal(upstreamCalls, 1);
    now += 2001;
    assert.equal((await route.POST(request())).status, 200);
    assert.equal(upstreamCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    clearAllModelLockouts();
  }
});

test("Auto uses the existing rate-limit backoff and expires", async () => {
  await settings.updateSettings({ resilienceSettings: { providerQuotaOverrides: {} } });
  const originalFetch = globalThis.fetch,
    originalNow = Date.now;
  let now = originalNow(),
    upstreamCalls = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {
    upstreamCalls++;
    return upstreamCalls <= 2
      ? new Response("rate limited", { status: 429 })
      : new Response("# Example Domain");
  };
  try {
    const first = await route.POST(request());
    assert.equal(first.status, 429);
    const seconds = Number(first.headers.get("retry-after"));
    assert.ok(seconds > 0);
    assert.equal((await route.POST(request())).status, 429);
    assert.equal(upstreamCalls, 1);
    now += seconds * 1000 + 1;
    const second = await route.POST(request());
    assert.equal(second.status, 429);
    const nextSeconds = Number(second.headers.get("retry-after"));
    assert.ok(nextSeconds > seconds);
    assert.equal((await route.POST(request())).status, 429);
    assert.equal(upstreamCalls, 2);
    now += nextSeconds * 1000 + 1;
    assert.equal((await route.POST(request())).status, 200);
    assert.equal(upstreamCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    clearAllModelLockouts();
  }
});

test("client and dashboard routes share the no-auth lockout", async () => {
  await settings.updateSettings({
    resilienceSettings: { providerQuotaOverrides: { mdream: { rateLimitCooldownSeconds: 15 } } },
  });
  const token = await session.mintDashboardSessionToken(session.getDashboardJwtSecret()!);
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    return new Response("rate limited", { status: 429 });
  };
  try {
    assert.equal((await route.POST(request())).status, 429);
    const dashboardRequest = new Request("http://localhost/api/search/fetch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${session.DASHBOARD_SESSION_COOKIE}=${token}`,
      },
      body: JSON.stringify({ provider: "mdream", format: "markdown", url: "https://example.com/" }),
    });
    assert.equal((await dashboard.POST(dashboardRequest)).status, 429);
    assert.equal(upstreamCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearAllModelLockouts();
  }
});

test("existing no-auth lockouts do not cross process boundaries", () => {
  lockModel("mdream", "noauth", "web-fetch", "rate_limit_exceeded", 15000);
  try {
    const code = `const m = await import("./open-sse/services/accountFallback.ts"); process.stdout.write(String(m.getModelLockoutInfo("mdream", "noauth", "web-fetch") === null));`;
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx/esm", "--input-type=module", "-e", code],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    assert.match(output, /true$/);
  } finally {
    clearAllModelLockouts();
  }
});
