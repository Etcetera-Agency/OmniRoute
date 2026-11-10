import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdream-retry-"));
process.env.DATA_DIR = dataDir;
process.env.REQUIRE_API_KEY = "false";
process.env.JWT_SECRET = "mdream-retry-test-secret";
const core = await import("../../src/lib/db/core.ts");
const settings = await import("../../src/lib/db/settings.ts");
function clearCooldown() {
  core
    .getDbInstance()
    .prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?")
    .run("providerCooldown", "mdream");
}
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
  clearCooldown();
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
    clearCooldown();
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
    clearCooldown();
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
    clearCooldown();
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
    clearCooldown();
  }
});

test("dashboard route in another process observes a persisted client cooldown", async () => {
  await settings.updateSettings({
    resilienceSettings: { providerQuotaOverrides: { mdream: { rateLimitCooldownSeconds: 15 } } },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  try {
    assert.equal((await route.POST(request())).status, 429);
    const token = await session.mintDashboardSessionToken(session.getDashboardJwtSecret()!);
    const code = `const route = await import("./src/app/api/search/fetch/route.ts");
      globalThis.fetch = async () => { throw new Error("unexpected upstream call"); };
      const request = new Request("http://localhost/api/search/fetch", {method:"POST", headers:{"content-type":"application/json", cookie:process.env.TEST_COOKIE}, body:JSON.stringify({provider:"mdream",format:"markdown",url:"https://example.com/"})});
      const response = await route.POST(request); process.stdout.write("RESULT=" + response.status);`;
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx/esm", "--input-type=module", "-e", code],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, TEST_COOKIE: `${session.DASHBOARD_SESSION_COOKIE}=${token}` },
      }
    );
    assert.match(output, /RESULT=429/);
  } finally {
    globalThis.fetch = originalFetch;
    clearCooldown();
  }
});

test("concurrent failures preserve the longest cooldown and a stale success cannot clear it", async () => {
  const cooldown = await import("../../src/lib/db/mdreamCooldown.ts");
  const now = Date.now();
  cooldown.recordMdreamCooldown(3000, 15000, now);
  cooldown.recordMdreamCooldown(3000, 2000, now + 1);
  cooldown.clearMdreamCooldownBefore(now);
  assert.equal(cooldown.mdreamCooldownRemaining(now + 1), 14999);
  clearCooldown();
});

test("parallel processes atomically preserve the longest upstream delay", async () => {
  const code = `const m = await import("./src/lib/db/mdreamCooldown.ts"); m.recordMdreamCooldown(3000, Number(process.env.TEST_DELAY));`;
  try {
    await Promise.all(
      [2000, 15000, 4000, 10000].map((delay) =>
        promisify(execFile)(
          process.execPath,
          ["--import", "tsx/esm", "--input-type=module", "-e", code],
          { cwd: process.cwd(), env: { ...process.env, TEST_DELAY: String(delay) } }
        )
      )
    );
    const cooldown = await import("../../src/lib/db/mdreamCooldown.ts");
    assert.ok(cooldown.mdreamCooldownRemaining() > 13000);
  } finally {
    clearCooldown();
  }
});

test("skill Web Fetch respects a cooldown created by the client route", async () => {
  const skill = await import("../../src/lib/skills/webFetchExecution.ts");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("limited", { status: 429 });
  };
  try {
    assert.equal((await route.POST(request())).status, 429);
    await assert.rejects(
      skill.executeWebFetch({ provider: "mdream", url: "https://example.com/" }),
      { statusCode: 429 }
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearCooldown();
  }
});
