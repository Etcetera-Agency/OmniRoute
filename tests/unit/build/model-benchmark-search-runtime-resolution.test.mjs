import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const metadataPath =
  process.env.BENCHMARK_OPERATOR_METAFILE ??
  path.resolve("dist/ops/reprocess-model-benchmark-search.meta.json");
const buildRoot = path.resolve(process.env.BENCHMARK_OPERATOR_ROOT ?? process.cwd());

test("direct benchmark operator static module graph resolves in runtime dependencies", async () => {
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const outputs = new Map(
    Object.entries(metadata.outputs).map(([name, output]) => [
      path.resolve(buildRoot, name),
      output,
    ])
  );
  const foundEntry = [...outputs.entries()].find(
    ([, output]) => output.entryPoint === "scripts/ops/reprocess-model-benchmark-search.ts"
  );
  assert.ok(foundEntry, "bundler metadata must contain direct operator entry");
  const [entryPath] = foundEntry;

  const pending = [entryPath];
  const visited = new Set();
  const externalImports = new Set();
  while (pending.length) {
    const outputPath = pending.pop();
    if (visited.has(outputPath)) continue;
    visited.add(outputPath);

    const output = outputs.get(outputPath);
    assert.ok(output, `missing emitted chunk: ${outputPath}`);
    for (const item of output.imports) {
      // AICODE-NOTE: Follow operator entry imports. Leave deeper lazy queue and normalization chunks deferred.
      if (
        !["import", "import-statement"].includes(item.kind) &&
        !(outputPath === entryPath && item.kind === "dynamic-import")
      ) {
        continue;
      }
      if (item.external) {
        assert.doesNotMatch(item.path, /@aws-sdk\/client-bedrock-runtime/);
        const resolved = import.meta.resolve(item.path, pathToFileURL(outputPath).href);
        if (resolved.startsWith("file:")) {
          assert.equal(
            (await stat(fileURLToPath(resolved))).isFile(),
            true,
            `${item.path} must exist`
          );
        }
        externalImports.add(item.path);
        continue;
      }

      pending.push(path.resolve(buildRoot, item.path));
    }
  }

  console.log(
    `Resolved ${visited.size} emitted files and ${externalImports.size} external imports ` +
      "without evaluating modules."
  );
});
