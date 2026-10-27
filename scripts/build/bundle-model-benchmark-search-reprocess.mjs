import { rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = resolve(root, "dist/ops");

await rm(outputDir, { recursive: true, force: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ["scripts/ops/reprocess-model-benchmark-search.ts"],
  outdir: "dist/ops",
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
  tsconfig: "tsconfig.json",
  metafile: true,
  logLevel: "info",
});
await writeFile(
  resolve(outputDir, "reprocess-model-benchmark-search.meta.json"),
  JSON.stringify(result.metafile)
);
