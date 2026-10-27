import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

await build({
  absWorkingDir: root,
  entryPoints: ["scripts/ops/reprocess-model-benchmark-search.ts"],
  outfile: "dist/ops/reprocess-model-benchmark-search.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
  tsconfig: "tsconfig.json",
  logLevel: "info",
});
