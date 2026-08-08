import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error — plain .mjs gate script has no declaration file.
import { classifyPrTarget } from "../../scripts/check/check-pr-self-target.mjs";

test("same branch on both sides is rejected", () => {
  const result = classifyPrTarget({
    headRef: "release/v3.8.50",
    baseRef: "release/v3.8.50",
    headSha: "abc1234567",
    baseSha: "abc1234567",
  });
  assert.equal(result.verdict, "self-targeting");
  assert.match(result.reason, /never merge/);
});

test("normal PR passes", () => {
  assert.equal(
    classifyPrTarget({
      headRef: "fix/something",
      baseRef: "release/v3.8.50",
      headSha: "aaaaaaaaaa",
      baseSha: "bbbbbbbbbb",
    }).verdict,
    "ok"
  );
});

test("same branch name on a fork PR passes when repositories differ", () => {
  const result = classifyPrTarget({
    headRef: "main",
    baseRef: "main",
    headRepo: "contributor/omniroute",
    baseRepo: "diegosouzapw/OmniRoute",
    headSha: "aaaaaaaaaa",
    baseSha: "bbbbbbbbbb",
  });
  assert.equal(result.verdict, "ok");
});

test("equal SHAs on different branches only warn", () => {
  const result = classifyPrTarget({
    headRef: "fix/just-cut",
    baseRef: "release/v3.8.50",
    headSha: "cccccccccc",
    baseSha: "cccccccccc",
  });
  assert.equal(result.verdict, "empty-diff");
  assert.match(result.reason, /nothing to review yet/);
});

test("branch equality wins over SHA difference", () => {
  assert.equal(
    classifyPrTarget({
      headRef: "release/v3.8.50",
      baseRef: "release/v3.8.50",
      headSha: "aaaaaaaaaa",
      baseSha: "bbbbbbbbbb",
    }).verdict,
    "self-targeting"
  );
});

test("missing refs skip safely", () => {
  assert.equal(classifyPrTarget().verdict, "no-pr-context");
  assert.equal(classifyPrTarget({ headRef: "fix/x" }).verdict, "ok");
  assert.equal(classifyPrTarget({ baseRef: "main" }).verdict, "ok");
});

test("refs are trimmed before comparison", () => {
  assert.equal(
    classifyPrTarget({ headRef: " release/v3.8.50 ", baseRef: "release/v3.8.50" }).verdict,
    "self-targeting"
  );
});
