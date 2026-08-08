import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/electron-release.yml"), "utf8");

function jobBlock(name: string) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^  ${name}:\\s*$`).test(line));
  assert.ok(start >= 0, `electron workflow must define ${name}`);
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  \S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join("\n");
}

test("Linux desktop build selects webpack fallback", () => {
  const build = jobBlock("build");
  assert.match(build, /OMNIROUTE_USE_TURBOPACK:/);
  assert.match(build, /matrix\.platform == 'linux'[^\n]*'0'/);
});

test("release keeps partial platform artifacts", () => {
  const release = jobBlock("release");
  assert.match(release, /if:\s*\$\{\{\s*!cancelled\(\)/);
  assert.match(release, /needs\.validate\.result == 'success'/);
  assert.match(release, /merge-mac-update-manifest\.mjs/);
  assert.match(release, /! -name latest-mac\.yml/);
});

test("asset verification is separate from npm publish", () => {
  const verifier = jobBlock("verify-desktop-assets");
  for (const pattern of [
    "exe",
    "AppImage",
    "deb",
    "^latest\\.yml$",
    "^latest-mac\\.yml$",
    "^latest-linux\\.yml$",
    "source\\.tar\\.gz",
  ]) {
    assert.ok(verifier.includes(pattern), `verifier must check ${pattern}`);
  }
  assert.match(verifier, /intel_dmg=.*grep -vE -- '-arm64\\.dmg\$'/);
  assert.match(verifier, /arm64_dmg=.*grep -E -- '-arm64\\.dmg\$'/);
  assert.match(verifier, /exit 1/);
  const npm = jobBlock("publish-npm");
  assert.match(npm, /needs:\s*\[validate, release\]/);
  assert.doesNotMatch(npm, /verify-desktop-assets/);
});
