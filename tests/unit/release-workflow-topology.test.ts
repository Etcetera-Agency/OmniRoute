import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflows = path.join(root, ".github/workflows");

function read(name: string) {
  return fs.readFileSync(path.join(workflows, name), "utf8");
}

test("intentional manual Node compatibility workflow remains unscheduled", () => {
  const yaml = read("nightly-compat.yml");
  assert.match(yaml, /workflow_dispatch:/);
  assert.doesNotMatch(yaml, /^\s+schedule:/m);
});

test("fork image workflows remain present and unchanged in destination", () => {
  const fork = read("build-fork.yml");
  const rinseaid = read("build-rinseaid-image.yml");
  assert.match(fork, /name: Publish Fork Image to GHCR/);
  assert.match(fork, /IMAGE_NAME: ghcr\.io\/kang-heewon\/omniroute/);
  assert.match(rinseaid, /name: Build Rinseaid OmniRoute image/);
  assert.match(rinseaid, /ghcr\.io\/rinseaid\/omniroute:k3-reasoning-/);
});

test("continuous release workflow keeps push/manual topology without a schedule", () => {
  const yaml = read("nightly-release-green.yml");
  assert.match(yaml, /push:/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.doesNotMatch(yaml, /^\s+schedule:/m);
});
