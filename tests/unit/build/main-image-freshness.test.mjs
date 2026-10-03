import assert from "node:assert/strict";
import test from "node:test";

const policyUrl = new URL("../../../scripts/ci/check-main-image-current.mjs", import.meta.url);
const policy = await import(policyUrl.href).catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

test("only a full-SHA workflow run for the current canonical main commit may move :main", () => {
  assert.ok(policy, "main freshness policy must exist");
  assert.equal(typeof policy.isCurrentMainImage, "function");

  const sha = "1234567890abcdef1234567890abcdef12345678";
  assert.equal(
    policy.isCurrentMainImage({ ref: "refs/heads/main", sourceSha: sha, mainSha: sha }),
    true
  );
  assert.equal(
    policy.isCurrentMainImage({
      ref: "refs/heads/main",
      sourceSha: sha,
      mainSha: "f".repeat(40),
    }),
    false
  );
  assert.equal(
    policy.isCurrentMainImage({ ref: "refs/heads/feature/test", sourceSha: sha, mainSha: sha }),
    false
  );
  assert.equal(
    policy.isCurrentMainImage({
      ref: "refs/heads/main",
      sourceSha: "not-a-full-sha",
      mainSha: sha,
    }),
    false
  );
});
