import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = process.cwd();
const sourceFiles = [
  "open-sse/services/combo/resolveAutoStrategy.ts",
  "open-sse/utils/opencodeHeaders.ts",
].map((file) => path.resolve(root, file));

test("affected OpenSSE modules have no duplicate TypeScript bindings", () => {
  const program = ts.createProgram(sourceFiles, {
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  });
  const duplicates = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.code === 2300);
  const messages = duplicates.map((diagnostic) => {
    const file = diagnostic.file?.fileName ?? "unknown file";
    const line = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    return `${path.relative(root, file)}:${line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
  });

  assert.deepEqual(messages, [], messages.join("\n"));
});
