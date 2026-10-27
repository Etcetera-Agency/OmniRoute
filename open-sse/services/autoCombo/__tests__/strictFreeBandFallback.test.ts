import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, it } from "vitest";

const previousEnv = {
  dataDir: process.env.DATA_DIR,
  bandsEnabled: process.env.OMNIROUTE_AUTO_BANDS,
  fullPoolFallback: process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL,
};
const testDataDir = mkdtempSync(path.join(tmpdir(), "omniroute-auto-strict-free-band-"));
process.env.DATA_DIR = testDataDir;
process.env.OMNIROUTE_AUTO_BANDS = "1";
process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL = "1";

const [
  { createVirtualAutoComboFromPrepared },
  { updateSettings },
  { resetDbInstance },
  { resolveAutoRoutingState },
  { createProviderConnection },
  { expandAutoComboCandidatePool },
] = await Promise.all([
  import("../virtualFactory"),
  import("../../../../src/lib/db/settings"),
  import("../../../../src/lib/db/core"),
  import("../../../../src/sse/handlers/autoRouting"),
  import("../../../../src/lib/db/providers"),
  import("../../combo/autoStrategy"),
]);

afterAll(() => {
  resetDbInstance();
  rmSync(testDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (previousEnv.dataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousEnv.dataDir;
  if (previousEnv.bandsEnabled === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = previousEnv.bandsEnabled;
  if (previousEnv.fullPoolFallback === undefined) {
    delete process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL;
  } else {
    process.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL = previousEnv.fullPoolFallback;
  }
});

it("does not expand an explicit free band to the full pool", async () => {
  await updateSettings({ freeAccessPolicy: "strict" });
  const routing = await resolveAutoRoutingState("auto/general_high_so:free");
  assert.deepEqual(routing.spec, { category: "general_high_so", tier: "free" });
  const combo = await createVirtualAutoComboFromPrepared(
    {
      regularCandidates: [
        {
          provider: "openrouter",
          connectionId: "paid-account",
          model: "openai/gpt-4.1",
          modelStr: "openrouter/openai/gpt-4.1",
          costPer1MTokens: 1,
        },
      ],
      familyCandidates: [],
    },
    routing.variant,
    routing.spec
  );

  assert.deepEqual(combo.models, []);
  assert.deepEqual(combo.candidatePool, []);

  await createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "strict-free-empty-pool-expansion-test",
    apiKey: "test-only-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  const expanded = await expandAutoComboCandidatePool([], {
    name: "auto/general_high_so:free",
    autoConfig: combo.autoConfig,
    config: combo.config,
    models: [],
  });
  assert.deepEqual(expanded, []);
});
