import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/npm-publish.yml"), "utf8");

function artifactStep() {
  const name = "Reuse CI's next-build artifact (skips the heavy rebuild)";
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line.includes(`- name: ${name}`));
  assert.ok(start >= 0, "artifact reuse step must exist");
  const indent = lines[start].indexOf("- name:");
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].slice(indent).startsWith("- ")) break;
    block.push(lines[i]);
  }
  return block.join("\n");
}

test("artifact reuse filters to same repository and head SHA", () => {
  const step = artifactStep();
  assert.match(step, /head_repository\.full_name == env\.REPO/);
  assert.match(step, /head_sha=\$HEAD_SHA/);
  assert.doesNotMatch(step, /\.conclusion == "success"/);
  assert.match(step, /gh run download .*--name next-build/);
  assert.match(step, /for candidate in \$CANDIDATES/);
});

test("artifact workflow inputs stay env-only", () => {
  const step = artifactStep();
  assert.match(step, /REPO:\s*\$\{\{\s*github\.repository\s*\}\}/);
  const runBody = step.slice(step.indexOf("run: |"));
  assert.doesNotMatch(runBody, /\$\{\{/);
});

test("artifact miss falls through to full build", () => {
  const step = artifactStep();
  assert.match(step, /continue-on-error:\s*true/);
  assert.match(step, /falling back to a full build/);
});

test("publish runs upgrade gate before staging", () => {
  const gate = workflow.indexOf("run: npm run check:install-upgrade");
  const stage = workflow.indexOf("          npm stage publish");
  assert.ok(gate >= 0 && stage > gate, "upgrade gate must precede npm stage publish");
});
