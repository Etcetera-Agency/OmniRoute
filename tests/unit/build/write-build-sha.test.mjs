import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WRITER = path.join(REPO_ROOT, "scripts/build/write-build-sha.mjs");
const FIXTURE_ROOT = path.join(REPO_ROOT, ".tmp", "build-sha-tests");
assert.equal(path.relative(REPO_ROOT, FIXTURE_ROOT), path.join(".tmp", "build-sha-tests"));
const SOURCE_SHA = "484bae128d6c895ff1f106adb9afebd001e9073a";
const OTHER_SHA = "e461ed673dd360d3759d3fbfa7ec402068448570";

function runWriter(arguments_, buildSha, nextDistDir) {
  return spawnSync(process.execPath, [WRITER, ...arguments_], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      OMNIROUTE_BUILD_SHA: buildSha,
      NEXT_DIST_DIR: nextDistDir,
    },
  });
}

function selectedServerPath(name) {
  return path.join(FIXTURE_ROOT, `${process.pid}-${name}`, "server", "BUILD_SHA");
}

function selectedDistPath(name) {
  return path.relative(REPO_ROOT, path.join(FIXTURE_ROOT, `${process.pid}-${name}`));
}

test("validate-only rejects an empty source SHA", () => {
  const result = runWriter(["--validate-only"], "", selectedDistPath("empty"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /40-character lowercase commit SHA/i);
});

test("validate-only rejects a short source SHA", () => {
  const result = runWriter(["--validate-only"], SOURCE_SHA.slice(0, 7), selectedDistPath("short"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /40-character lowercase commit SHA/i);
});

test("validate-only rejects a source SHA longer than 40 characters", () => {
  const result = runWriter(["--validate-only"], `${SOURCE_SHA}a`, selectedDistPath("long"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /40-character lowercase commit SHA/i);
});

test("validate-only rejects non-hexadecimal source SHA characters", () => {
  const result = runWriter(["--validate-only"], "g".repeat(40), selectedDistPath("non-hex"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /40-character lowercase commit SHA/i);
});

test("validate-only rejects uppercase source SHA characters", () => {
  const result = runWriter(
    ["--validate-only"],
    SOURCE_SHA.toUpperCase(),
    selectedDistPath("uppercase")
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /40-character lowercase commit SHA/i);
});

test("validate-only accepts a full SHA without writing a stamp or creating output", () => {
  const nextDistDir = selectedDistPath(`valid-${process.pid}`);
  const result = runWriter(["--validate-only"], SOURCE_SHA, nextDistDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /validated full source SHA/i);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, nextDistDir)), false);
});

test("prebuilt backend export accepts a matching full server BUILD_SHA", () => {
  fs.mkdirSync(path.dirname(selectedServerPath("matching")), { recursive: true });
  fs.writeFileSync(selectedServerPath("matching"), `${SOURCE_SHA}\n`);
  const result = runWriter(["--verify-server"], SOURCE_SHA, selectedDistPath("matching"));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /selected server BUILD_SHA matches/i);
});

test("selected-server stamp must contain exactly the full SHA and one LF", () => {
  for (const [name, stamp] of [
    ["no-lf", SOURCE_SHA],
    ["extra-lf", `${SOURCE_SHA}\n\n`],
    ["space", `${SOURCE_SHA} \n`],
  ]) {
    fs.mkdirSync(path.dirname(selectedServerPath(name)), { recursive: true });
    fs.writeFileSync(selectedServerPath(name), stamp);
    const result = runWriter(["--verify-server"], SOURCE_SHA, selectedDistPath(name));
    assert.notEqual(result.status, 0, name);
  }
});

test("prebuilt backend export rejects a missing server BUILD_SHA", () => {
  const result = runWriter(
    ["--verify-server"],
    SOURCE_SHA,
    selectedDistPath(`missing-${process.pid}`)
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /selected server BUILD_SHA is missing/i);
});

test("selected-server verification rejects a stamp from another source revision", () => {
  fs.mkdirSync(path.dirname(selectedServerPath("mismatch")), { recursive: true });
  fs.writeFileSync(selectedServerPath("mismatch"), `${OTHER_SHA}\n`);
  const result = runWriter(["--verify-server"], SOURCE_SHA, selectedDistPath("mismatch"));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /selected server BUILD_SHA does not match/i);
});

test("selected-server verification rejects a malformed stamp", () => {
  fs.mkdirSync(path.dirname(selectedServerPath("malformed")), { recursive: true });
  fs.writeFileSync(selectedServerPath("malformed"), "484bae1\n");
  const result = runWriter(["--verify-server"], SOURCE_SHA, selectedDistPath("malformed"));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /selected server BUILD_SHA is invalid/i);
});

test("selected-server verification rejects an invalid expected source SHA", () => {
  fs.mkdirSync(path.dirname(selectedServerPath("invalid-expected")), { recursive: true });
  fs.writeFileSync(selectedServerPath("invalid-expected"), `${SOURCE_SHA}\n`);
  const result = runWriter(
    ["--verify-server"],
    SOURCE_SHA.slice(0, 7),
    selectedDistPath("invalid-expected")
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /40-character lowercase commit SHA/i);
});

test("selected-server verification rejects whitespace around the expected SHA", () => {
  const result = runWriter(
    ["--verify-server"],
    ` ${SOURCE_SHA} `,
    selectedDistPath("whitespace-expected")
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /40-character lowercase commit SHA/i);
});
