# Design: Duplicate import binding repair

## Scope

Repair only the duplicate import declarations proven in workflow run `40871049172`.
Treat import cleanup as a source syntax repair: module exports, call sites, ordering,
runtime values, and all non-import source remain unchanged.

## Source changes

1. In `resolveAutoStrategy.ts`, keep the first import from `../autoCombo/bands` and remove
   its identical second declaration. All four imported names remain available.
2. In `opencodeHeaders.ts`, replace the two imports from `./opencodeCliVersion.ts` with
   one declaration importing the union of used names:
   `getCachedOpencodeCliVersion`, `refreshOpencodeCliVersion`, and
   `OPENCODE_CLI_V2_VERSION_FALLBACK`.
3. Do not alter import use sites or unrelated declarations.

## Regression check

Use the repository's TypeScript compiler API on only these two files, with module
resolution disabled to avoid pulling their dependency graph into this syntax regression.
Collect compiler diagnostics, retain TS2300 duplicate-identifier diagnostics, and fail if
any remain. Other unresolved-import/type diagnostics produced by this intentionally
isolated program are outside this check and must not be mistaken for a green full
typecheck.

Pseudocode:

```text
files = [resolveAutoStrategy.ts, opencodeHeaders.ts]
program = createTypeScriptProgram(files, noResolve=true, noEmit=true)
duplicates = diagnostics(program).filter(code == 2300)
assert duplicates is empty
```

TDD order: add the compiler-backed check, run it against the clean base and observe
TS2300 failures from both modules, remove only duplicate imports, then rerun the same
check. A successful focused check is not evidence that Next.js webpack compiled or an
ARM64 image was built.

## Verification boundaries

- Focused check: exact duplicate-identifier compiler diagnostics for the two changed
  modules.
- Parse-only esbuild transpilation is insufficient by itself because it accepts identical
  repeated imports; TypeScript's binder reports the actual TS2300 failure seen in the
  OpenSSE check.
- Full project typecheck, webpack/Next.js compilation, image build, workflow dispatch,
  publish, and deploy are outside this source-only task.
