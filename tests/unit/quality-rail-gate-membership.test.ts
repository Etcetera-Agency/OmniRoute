import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/quality.yml"), "utf8");
const ciWorkflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const codeqlWorkflow = fs.readFileSync(path.join(root, ".github/workflows/codeql.yml"), "utf8");
const pinnedWorkflowNames = [
  "ci.yml",
  "codeql.yml",
  "docker-publish.yml",
  "electron-release.yml",
  "npm-publish.yml",
  "quality.yml",
];

test("quality rail uses base-relative file-size mode", () => {
  assert.match(workflow, /PR_BASE_SHA:.*github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /npm run check:file-size -- --base-ref \"\$PR_BASE_SHA\"/);
});

test("quality rail pins all scanner versions and avoids latest installer", () => {
  for (const needle of [
    "GITLEAKS_VERSION=v",
    "OSV_SCANNER_VERSION=v",
    "ACTIONLINT_VERSION=1.7.12",
    "ZIZMOR_VERSION=",
    "OASDIFF_VERSION=v",
  ]) {
    assert.ok(workflow.includes(needle), `missing pinned scanner ${needle}`);
  }
  assert.doesNotMatch(workflow, /download-actionlint\.bash\) latest/);
});

test("quality rail downloads oasdiff from the official repository", () => {
  assert.match(
    workflow,
    /gh release download "\$OASDIFF_VERSION" --repo oasdiff\/oasdiff --pattern/
  );
  assert.doesNotMatch(workflow, /--repo Tufin\/oasdiff\b/);
});

test("quality rail executes deterministic ratchets and security checks", () => {
  for (const needle of [
    "npm run check:cycles",
    "npm run check:lockfile",
    "npm run check:duplication",
    "npm run check:dead-code",
    "npm run check:type-coverage",
    "npm run check:compression-budget",
    "npm run check:secrets -- --ratchet",
    "npm run check:vuln-ratchet -- --ratchet",
    "npm run check:workflows -- --strict --ratchet",
    "npm run check:openapi-breaking -- --ratchet",
  ]) {
    assert.ok(workflow.includes(needle), `missing quality gate ${needle}`);
  }
});

test("lint guard keeps the quality ratchet and CodeQL gate", () => {
  for (const needle of [
    "npm run quality:collect",
    "check-quality-ratchet.mjs --allow-missing",
    "--require-tighten",
    "npm run check:codeql-ratchet",
  ]) {
    assert.ok(workflow.includes(needle), `missing lint-guard quality gate ${needle}`);
  }
  assert.match(workflow, /security-events:\s*read/);
});

test("main CI rejects self-target PRs and checks generated agent skills", () => {
  assert.match(ciWorkflow, /Reject a PR that targets its own branch/);
  assert.match(ciWorkflow, /npm run check:agent-skills-sync/);
  assert.match(ciWorkflow, /HEAD_REPO:.*pull_request\.head\.repo\.full_name/);
  assert.match(ciWorkflow, /BASE_REPO:.*pull_request\.base\.repo\.full_name/);
});

test("modified release workflows pin every external action by commit SHA", () => {
  const floating = [];
  const usesPattern = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm;
  for (const name of pinnedWorkflowNames) {
    const source = fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
    for (const match of source.matchAll(usesPattern)) {
      const target = match[1];
      if (target.startsWith("./")) continue;
      if (!/@[0-9a-f]{40}$/.test(target)) floating.push(`${name}: ${target}`);
    }
  }
  assert.deepEqual(floating, []);
});

test("CI workflow scanner install and lint are blocking", () => {
  const scannerStart = ciWorkflow.indexOf("Install required security scanners");
  const scannerEnd = ciWorkflow.indexOf("BLOCKING ratchet", scannerStart);
  const scanner = ciWorkflow.slice(scannerStart, scannerEnd);
  assert.doesNotMatch(scanner, /continue-on-error:\s*true/);
  assert.doesNotMatch(scanner, /set \+e/);
  assert.match(scanner, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
  assert.match(scanner, /command -v actionlint/);
  assert.match(scanner, /command -v zizmor/);
  assert.match(ciWorkflow, /npm run check:workflows -- --strict --ratchet/);
});

test("release quality scanner install cannot silently skip workflow tools", () => {
  const scannerStart = workflow.indexOf("Install pinned workflow/security scanners");
  const scannerEnd = workflow.indexOf("Secret scan (ratchet)", scannerStart);
  const scanner = workflow.slice(scannerStart, scannerEnd);
  assert.ok(scannerStart >= 0 && scannerEnd > scannerStart);
  assert.doesNotMatch(scanner, /continue-on-error:\s*true/);
  assert.doesNotMatch(scanner, /set \+e/);
  assert.match(scanner, /command -v actionlint/);
  assert.match(scanner, /command -v zizmor/);
  assert.match(workflow, /npm run check:workflows -- --strict --ratchet/);
});

test("CodeQL actions use the pinned release ref", () => {
  assert.match(codeqlWorkflow, /github\/codeql-action\/(?:init|analyze)@[0-9a-f]{40} # v4\.37\.4/);
});
