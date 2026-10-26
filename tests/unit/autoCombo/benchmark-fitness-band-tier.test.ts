import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-benchmark-band-tier-"));
process.env.DATA_DIR = TEST_DATA_DIR;
const originalFlag = process.env.OMNIROUTE_AUTO_BANDS;
process.env.OMNIROUTE_AUTO_BANDS = "1";
const core = await import("../../../src/lib/db/core.ts");
const intelligence = await import("../../../src/lib/db/modelIntelligence.ts");
const fitness = await import("../../../open-sse/services/autoCombo/taskFitness.ts");
const bands = await import("../../../open-sse/services/autoCombo/bands/index.ts");

function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  process.env.OMNIROUTE_AUTO_BANDS = "1";
  fitness.invalidateFitnessCache();
}

beforeEach(() => resetStorage());
afterEach(() => {
  fitness.invalidateFitnessCache();
  core.resetDbInstance();
});
afterAll(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (originalFlag === undefined) delete process.env.OMNIROUTE_AUTO_BANDS;
  else process.env.OMNIROUTE_AUTO_BANDS = originalFlag;
});

it("benchmark scores participate in free bands only", () => {
  intelligence.upsertModelIntelligence({
    model: "scored-model",
    source: "benchmark_fitness",
    category: "coding",
    score: 0.8,
    eloRaw: null,
    confidence: "high",
    expiresAt: null,
  });
  fitness.invalidateFitnessCache();

  const candidate = { provider: "provider-a", model: "scored-model" };
  const freeCheck = bands.buildBandCheck("coding_high", "free");
  const paidCheck = bands.buildBandCheck("coding_high", "subscription");

  expect(freeCheck).not.toBeNull();
  expect(paidCheck).not.toBeNull();
  expect(freeCheck?.(candidate)).toBe(true);
  expect(paidCheck?.(candidate)).toBe(false);
});
