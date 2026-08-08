#!/usr/bin/env node
// Refuse a pull request that targets its own head branch.
//
// A self-targeting PR has no diff, can never merge, and otherwise burns CI/review attention.
// The guard runs before change classification so expensive jobs never start.
// AICODE-NOTE: equal branch refs are conclusive only within the same repository; a fork may
// legitimately use the same branch name as its base repository.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Classify a PR's head/base pair.
 *
 * Equal refs in the same repository reject. Equal SHAs on different refs only warn: a branch
 * may have just been cut and not received its first commit yet. Missing refs are treated as
 * non-PR context.
 */
export function classifyPrTarget({ headRef, baseRef, headSha, baseSha, headRepo, baseRepo } = {}) {
  const hr = String(headRef ?? "").trim();
  const br = String(baseRef ?? "").trim();
  const hs = String(headSha ?? "").trim();
  const bs = String(baseSha ?? "").trim();
  const hp = String(headRepo ?? "").trim();
  const bp = String(baseRepo ?? "").trim();
  const sameRepository = (!hp && !bp) || (Boolean(hp) && Boolean(bp) && hp === bp);

  if (!hr && !br) return { verdict: "no-pr-context" };

  if (hr && br && hr === br && sameRepository) {
    return {
      verdict: "self-targeting",
      reason: `head and base are the same branch (${hr}) — this PR has no diff and can never merge`,
    };
  }

  if (hs && bs && hs === bs) {
    return {
      verdict: "empty-diff",
      reason: `head and base point at the same commit (${hs.slice(0, 10)}) — nothing to review yet`,
    };
  }

  return { verdict: "ok" };
}

function main() {
  const result = classifyPrTarget({
    headRef: process.env.HEAD_REF,
    baseRef: process.env.BASE_REF,
    headSha: process.env.HEAD_SHA,
    baseSha: process.env.BASE_SHA,
    headRepo: process.env.HEAD_REPO,
    baseRepo: process.env.BASE_REPO,
  });

  if (result.verdict === "self-targeting") {
    process.stderr.write(
      `::error::PR targets its own branch — ${result.reason}.\n` +
        "Close it, or repoint the base at the branch you actually want to merge into.\n"
    );
    return 1;
  }

  if (result.verdict === "empty-diff") {
    process.stdout.write(`::warning::${result.reason}.\n`);
    return 0;
  }

  process.stdout.write(
    result.verdict === "no-pr-context"
      ? "[pr-self-target] no PR context — skipping.\n"
      : "[pr-self-target] OK — head and base differ.\n"
  );
  return 0;
}

if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
