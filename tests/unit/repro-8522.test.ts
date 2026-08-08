import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFileSizes } from "../../scripts/check/check-file-size.mjs";

test("base-relative file-size ratchet ignores inherited drift", () => {
  const result = evaluateFileSizes({ "src/foo.ts": 110 }, { "src/foo.ts": 100 }, 100, {
    "src/foo.ts": 110,
  });
  assert.deepEqual(result.violations, []);
});

test("base-relative file-size ratchet still catches PR growth", () => {
  const result = evaluateFileSizes({ "src/foo.ts": 112 }, { "src/foo.ts": 100 }, 100, {
    "src/foo.ts": 100,
  });
  assert.equal(result.violations.length, 1);
});
