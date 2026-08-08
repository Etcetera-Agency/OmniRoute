import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error — plain .mjs gate script has no declaration file.
import {
  evaluateConvergence,
  evaluatePreviousBoot,
} from "../../scripts/check/check-install-upgrade.mjs";

test("converged schemas pass", () => {
  const result = evaluateConvergence({ freshTables: ["a", "b"], upgradedTables: ["b", "a"] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("clean-only table always fails", () => {
  const result = evaluateConvergence({
    freshTables: ["a", "missing_on_upgrade"],
    upgradedTables: ["a"],
    residualAllowlist: { missing_on_upgrade: "not allowed" },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.onlyFresh, ["missing_on_upgrade"]);
});

test("allowlisted upgrade-only residue passes but stays visible", () => {
  const result = evaluateConvergence({
    freshTables: ["a"],
    upgradedTables: ["a", "cache_metrics"],
    residualAllowlist: { cache_metrics: "known historical residue" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.onlyUpgraded, ["cache_metrics"]);
  assert.deepEqual(result.unknownResidue, []);
});

test("unknown upgrade-only residue fails", () => {
  const result = evaluateConvergence({
    freshTables: ["a"],
    upgradedTables: ["a", "surprise_table"],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unknownResidue, ["surprise_table"]);
});

test("accepts Sets and empty inputs", () => {
  assert.equal(
    evaluateConvergence({ freshTables: new Set(["a"]), upgradedTables: new Set(["a"]) }).ok,
    true
  );
  assert.equal(evaluateConvergence({}).ok, true);
});

test("previous-version boot failure blocks the install-upgrade gate", () => {
  const result = evaluatePreviousBoot({
    previous: "3.8.48",
    result: {
      ok: false,
      failures: ["previous(3.8.48): exited with code 1 before serving"],
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    "previous version 3.8.48 did not boot cleanly — upgrade path unverified",
    "previous(3.8.48): exited with code 1 before serving",
  ]);
});

test("healthy previous version keeps the upgrade gate eligible", () => {
  const result = evaluatePreviousBoot({
    previous: "3.8.48",
    result: { ok: true, failures: [] },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});
