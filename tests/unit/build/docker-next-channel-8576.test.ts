import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const resolveScript = path.join(root, "scripts/ci/resolve-docker-publish-version.sh");
const promoteScript = path.join(root, "scripts/ci/should-promote-latest.sh");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/docker-publish.yml"), "utf8");

function resolveVersion(event: string, refType: string, refName: string, input = "") {
  return execFileSync("bash", [resolveScript, event, refType, refName, input], {
    encoding: "utf8",
  }).trim();
}

function shouldPromote(version: string, tags: string[] = []) {
  return execFileSync("bash", [promoteScript, version], {
    input: tags.length ? `${tags.join("\n")}\n` : "",
    encoding: "utf8",
  }).trim();
}

test("release branches are not Docker publication sources", () => {
  assert.throws(
    () => resolveVersion("push", "branch", "release/v3.8.50"),
    /Unsupported Docker publish branch/
  );
});

test("unsupported push branches fail closed", () => {
  assert.throws(
    () => resolveVersion("push", "branch", "feature/not-a-publish-source"),
    /Unsupported Docker publish branch/
  );
});

test("main, tag, dispatch, and release behavior remains unchanged", () => {
  assert.equal(resolveVersion("push", "branch", "main"), "main");
  assert.equal(resolveVersion("push", "tag", "v3.8.50"), "3.8.50");
  assert.equal(resolveVersion("workflow_dispatch", "branch", "main", "v3.8.50"), "3.8.50");
  assert.equal(resolveVersion("release", "tag", "v3.8.50"), "3.8.50");
});

test("floating and prerelease channels cannot promote latest", () => {
  assert.equal(shouldPromote("next", ["v99.0.0"]), "false");
  assert.equal(shouldPromote("main"), "false");
  assert.equal(shouldPromote("3.8.51-rc.1", ["v3.8.50"]), "false");
});

test("workflow preserves fork images and existing Docker trigger semantics", () => {
  assert.doesNotMatch(workflow, /release\/v\*/);
  assert.match(workflow, /\[ "\$VERSION" != "main" \] && \[ "\$VERSION" != "next" \]/);
  assert.match(workflow, /IMAGE_NAME: diegosouzapw\/omniroute/);
  assert.match(workflow, /GHCR_IMAGE_NAME: ghcr\.io\/diegosouzapw\/omniroute/);
});

test("next channel retains the blocking vulnerability gate", () => {
  const gate = workflow.match(/- name: Trivy CRITICAL gate \(blocking\)[\s\S]*?exit-code: "1"/);
  assert.ok(gate);
  assert.match(gate[0], /version != 'main'/);
  assert.doesNotMatch(gate[0], /version != 'next'/);
});
