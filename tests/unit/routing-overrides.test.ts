import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-routing-overrides-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const routing = await import("../../src/lib/routing/routingOverrides.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("routing override persists order and disabled providers", async () => {
  await routing.saveRoutingOverride({
    endpoint: "search",
    order: ["tavily-search", "brave-search", "tavily-search"],
    disabled: ["exa-search", "exa-search"],
  });

  const override = await routing.loadRoutingOverride("search");
  assert.deepEqual(override?.order, ["tavily-search", "brave-search"]);
  assert.deepEqual(override?.disabled, ["exa-search"]);
  assert.equal(typeof override?.updatedAt, "string");
});

test("effective order appends default providers missing from override", async () => {
  await routing.saveRoutingOverride({
    endpoint: "search",
    order: ["tavily-search"],
    disabled: [],
  });

  const order = await routing.resolveEffectiveProviderOrder("search", [
    "brave-search",
    "tavily-search",
    "exa-search",
  ]);

  assert.deepEqual(order, ["tavily-search", "brave-search", "exa-search"]);
});

test("effective order excludes disabled providers and honors eligibility", async () => {
  await routing.saveRoutingOverride({
    endpoint: "search",
    order: ["tavily-search", "brave-search", "exa-search"],
    disabled: ["brave-search"],
  });

  const order = await routing.resolveEffectiveProviderOrder(
    "search",
    ["brave-search", "tavily-search", "exa-search"],
    (id) => id !== "exa-search"
  );

  assert.deepEqual(order, ["tavily-search"]);
});

test("reset removes override and restores default order", async () => {
  await routing.saveRoutingOverride({
    endpoint: "fetch",
    order: ["jina-reader"],
    disabled: ["mdream"],
  });
  await routing.resetRoutingOverride("fetch");

  const override = await routing.loadRoutingOverride("fetch");
  const order = await routing.resolveEffectiveProviderOrder("fetch", ["mdream", "jina-reader"]);

  assert.equal(override, null);
  assert.deepEqual(order, ["mdream", "jina-reader"]);
});
