import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-web-fetch-"));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = "dashboard-web-fetch-test-secret";
process.env.REQUIRE_API_KEY = "true";

const core = await import("../../src/lib/db/core.ts");
const session = await import("../../src/shared/utils/dashboardSessionToken.ts");
const dashboard = await import("../../src/app/api/search/fetch/route.ts");
const client = await import("../../src/app/api/v1/web/fetch/route.ts");

function request(cookie?: string, url = "http://localhost/api/search/fetch") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ url: "https://example.com/", provider: "mdream", format: "markdown" }),
  });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("dashboard fetch requires a valid session and keeps client API key enforcement", async () => {
  const token = await session.mintDashboardSessionToken(session.getDashboardJwtSecret()!);
  const cookie = `${session.DASHBOARD_SESSION_COOKIE}=${token}`;
  assert.equal((await dashboard.POST(request())).status, 401);
  assert.equal(
    (await dashboard.POST(request(`${session.DASHBOARD_SESSION_COOKIE}=invalid`))).status,
    401
  );
  assert.equal(
    (await client.POST(request(cookie, "http://localhost/api/v1/web/fetch"))).status,
    401
  );
  const invalidKey = request(cookie);
  invalidKey.headers.set("authorization", "Bearer invalid-key");
  assert.equal((await dashboard.POST(invalidKey)).status, 401);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("# Example Domain", { status: 200 });
  try {
    const response = await dashboard.POST(request(cookie));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.provider, "mdream");
    assert.match(body.content, /Example Domain/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dashboard fetch is protected by management origin and session policy", async () => {
  const { classifyRoute } = await import("../../src/server/authz/classify.ts");
  assert.equal(classifyRoute("/api/search/fetch", "POST").routeClass, "MANAGEMENT");
  assert.equal(classifyRoute("/api/v1/web/fetch", "POST").routeClass, "CLIENT_API");
});

test("Mdream appears as keyless in the regular Web Fetch provider catalog", async () => {
  const { buildStaticProviderEntries, filterConfiguredProviderEntries } =
    await import("../../src/app/(dashboard)/dashboard/providers/providerPageUtils.ts");
  const entries = buildStaticProviderEntries("no-auth", () => ({ total: 0 }) as never);
  const mdream = entries.find((entry) => entry.providerId === "mdream");
  assert.ok(mdream);
  assert.equal((mdream.provider as { keylessOnly?: boolean }).keylessOnly, true);
  assert.ok(
    filterConfiguredProviderEntries(entries, true, "Mdream", true, "", "webFetch").some(
      (entry) => entry.providerId === "mdream"
    )
  );
});
