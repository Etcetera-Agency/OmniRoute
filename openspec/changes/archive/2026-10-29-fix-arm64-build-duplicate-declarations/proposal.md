# Change: Remove duplicate declarations blocking ARM64 builds

## Why

ARM64 workflow run `40871049172` stopped before publish and deploy because TypeScript
reported duplicate bindings in two OpenSSE production modules. `resolveAutoStrategy.ts`
imports the same band symbols twice; `opencodeHeaders.ts` imports cached CLI-version
helpers in two declarations. These duplicate imports provide no additional behavior and
prevent the compiler from binding either module.

## What Changes

- Keep one import declaration for the band symbols in `resolveAutoStrategy.ts`.
- Keep one import declaration in `opencodeHeaders.ts`, containing the cached-version
  helper, refresh helper, and v2 fallback constant used by the module.
- Add a focused TypeScript compiler regression test for duplicate-identifier diagnostics
  in those two modules.
- Record the source-compilation invariant and exact verification boundary.

No routing, provider selection, model filtering, benchmark, migration, image, workflow,
or runtime behavior changes.

## Impact

- Affected production sources: `open-sse/services/combo/resolveAutoStrategy.ts` and
  `open-sse/utils/opencodeHeaders.ts`.
- Affected regression test: `tests/unit/build/duplicate-import-bindings.test.mjs`.
- No public API, runtime contract, database schema, or deployment configuration changes.
- The focused compiler test checks TypeScript duplicate-identifier diagnostics for the two
  affected modules; it does not claim full application typecheck or image-build acceptance.
