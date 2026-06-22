import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-shared-creds-"));
process.env.API_KEY_SECRET = "test-api-key-secret-shared-creds";
process.env.INITIAL_PASSWORD = "";
process.env.DASHBOARD_PASSWORD = "";
process.env.JWT_SECRET = "test-jwt-secret-shared-creds";
process.env.MODEL_SYNC_INTERNAL_SECRET = "test-model-sync-secret";
process.env.MODEL_SYNC_INTERNAL_BASE_URL = "http://127.0.0.1:1";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const auth = await import("../../src/sse/services/auth.ts");
const { getSharedCredentialProviderIds } =
  await import("../../src/lib/providers/sharedCredentials.ts");
const providersRoute = await import("../../src/app/api/providers/route.ts");

function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
}

function createRequest(provider: string, apiKey = "shared-key") {
  return new Request("http://localhost/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      name: `${provider} key`,
      apiKey,
      testStatus: "active",
    }),
  });
}

test.beforeEach(() => {
  resetStorage();
});

test.after(() => {
  resetStorage();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
});

test("shared credential groups include service provider ids", () => {
  assert.deepEqual(getSharedCredentialProviderIds("parallel"), [
    "parallel",
    "parallel-search",
    "parallel-extract",
  ]);
  assert.deepEqual(getSharedCredentialProviderIds("jina-reader"), ["jina-ai", "jina-reader"]);
  assert.deepEqual(getSharedCredentialProviderIds("firecrawl-search"), [
    "firecrawl",
    "firecrawl-search",
  ]);
  assert.deepEqual(getSharedCredentialProviderIds("openai"), ["openai"]);
});

test("POST /api/providers creates visible sibling connections for a shared parallel key", async () => {
  const response = await providersRoute.POST(createRequest("parallel"));
  assert.equal(response.status, 201);

  const connections = await providersDb.getProviderConnections();
  const providers = connections.map((connection: any) => connection.provider).sort();

  assert.deepEqual(providers, ["parallel", "parallel-extract", "parallel-search"]);
});

test("POST /api/providers spreads a Jina AI key to Jina Reader", async () => {
  const response = await providersRoute.POST(createRequest("jina-ai"));
  assert.equal(response.status, 201);

  const connections = await providersDb.getProviderConnections();
  const providers = connections.map((connection: any) => connection.provider).sort();

  assert.deepEqual(providers, ["jina-ai", "jina-reader"]);
});

test("POST /api/providers does not duplicate existing shared credential siblings", async () => {
  await providersDb.createProviderConnection({
    provider: "parallel-search",
    authType: "apikey",
    name: "existing search",
    apiKey: "existing-key",
    isActive: true,
    testStatus: "active",
  });

  const response = await providersRoute.POST(createRequest("parallel"));
  assert.equal(response.status, 201);

  const connections = await providersDb.getProviderConnections();
  const providerCounts = connections.reduce((counts: Record<string, number>, connection: any) => {
    counts[connection.provider] = (counts[connection.provider] || 0) + 1;
    return counts;
  }, {});

  assert.equal(providerCounts.parallel, 1);
  assert.equal(providerCounts["parallel-search"], 1);
  assert.equal(providerCounts["parallel-extract"], 1);
});

test("credential resolver finds a sibling provider from one shared DB row", async () => {
  await providersDb.createProviderConnection({
    provider: "parallel",
    authType: "apikey",
    name: "shared parallel",
    apiKey: "parallel-key",
    isActive: true,
    testStatus: "active",
  });

  const credentials = await auth.getProviderCredentials("parallel-extract");

  assert.equal(credentials?.apiKey, "parallel-key");
  assert.equal(credentials?.provider, "parallel");
});
