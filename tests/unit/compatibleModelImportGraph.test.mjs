import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tsconfigPath = path.join(repoRoot, "tsconfig.json");
const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
const compilerOptions = ts.parseJsonConfigFileContent(
  tsconfig.config,
  ts.sys,
  path.dirname(tsconfigPath)
).options;

async function readSource(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

function resolveLocalImport(specifier, importer) {
  const resolvedPath = ts.resolveModuleName(
    specifier,
    path.join(repoRoot, importer),
    compilerOptions,
    ts.sys
  ).resolvedModule?.resolvedFileName;
  return resolvedPath?.startsWith(`${repoRoot}${path.sep}`)
    ? path.relative(repoRoot, resolvedPath)
    : null;
}

function collectReachableLocalSources(entryPath) {
  const pending = [entryPath];
  const reachable = new Set();
  while (pending.length > 0) {
    const filePath = pending.pop();
    if (reachable.has(filePath)) continue;
    reachable.add(filePath);
    const source = readFileSync(path.join(repoRoot, filePath), "utf8");
    for (const { fileName: specifier } of ts.preProcessFile(source).importedFiles) {
      const resolved = resolveLocalImport(specifier, filePath);
      if (resolved) pending.push(resolved);
    }
  }
  return reachable;
}

function collectDirectLocalSources(entryPath) {
  const source = readFileSync(path.join(repoRoot, entryPath), "utf8");
  return new Set(
    ts
      .preProcessFile(source)
      .importedFiles.map(({ fileName: specifier }) => resolveLocalImport(specifier, entryPath))
      .filter(Boolean)
  );
}

test("compatible discovery stays outside provider validation runtime graph", () => {
  const reachable = collectReachableLocalSources("src/lib/providers/compatibleModelDiscovery.ts");

  for (const runtimeModule of [
    "src/lib/providers/validation/urlHelpers.ts",
    "open-sse/services/claudeCodeCompatible.ts",
    "src/lib/modelCapabilities.ts",
    "src/lib/modelCapabilityResolutionSnapshot.ts",
    "src/lib/modelsDevSync.ts",
  ]) {
    assert.equal(reachable.has(runtimeModule), false, `${runtimeModule} entered discovery graph`);
  }
  assert.ok(reachable.has("src/shared/utils/compatibleProviderUrls.ts"));
  assert.ok(reachable.has("src/shared/constants/upstreamHeaders.ts"));
});

test("context-limit modules keep one-way initialization dependency", () => {
  const contextManager = collectDirectLocalSources("open-sse/services/contextManager.ts");
  const comboContextLimit = collectDirectLocalSources("open-sse/services/comboContextLimit.ts");

  assert.equal(
    contextManager.has("open-sse/services/comboContextLimit.ts"),
    false,
    "contextManager must not re-import comboContextLimit during module initialization"
  );
  assert.equal(
    comboContextLimit.has("open-sse/services/contextManager.ts"),
    true,
    "comboContextLimit must continue to use the existing token-limit resolver"
  );
});

test("operator runtime mode imports benchmark module before its success exit", async () => {
  const operator = await readSource("scripts/ops/reprocess-model-benchmark-search.ts");
  const importPosition = operator.indexOf('await import("../../src/lib/modelBenchmarkSearch")');
  const runtimeCheckPosition = operator.indexOf("if (runtimeCheck)");
  const successExitPosition = operator.indexOf("process.exit(0)", runtimeCheckPosition);

  assert.match(operator, /const runtimeCheck = process\.argv\.includes\("--check-runtime"\)/);
  assert.ok(importPosition >= 0, "operator does not await the benchmark module import");
  assert.ok(runtimeCheckPosition > importPosition, "runtime-check branch runs before the import");
  assert.ok(successExitPosition > runtimeCheckPosition, "runtime-check branch has no success exit");
});
