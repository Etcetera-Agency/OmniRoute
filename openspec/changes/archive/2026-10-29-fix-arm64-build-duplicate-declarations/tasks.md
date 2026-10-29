# Tasks

## 1. Reproduce and repair

- [x] 1.1 Add a focused TypeScript compiler regression test covering duplicate-identifier
  diagnostics in the two affected production modules.
- [x] 1.2 Run the new test against the clean base and record RED evidence for both
  duplicate import bindings.
- [x] 1.3 Remove the duplicate band import and consolidate the OpenCode CLI-version
  imports while retaining every used name.
- [x] 1.4 Run the same focused test and verify GREEN with no duplicate-identifier
  diagnostics.

## 2. Review and record

- [x] 2.1 Inspect only the two changed modules for repeated import declarations matching
  the workflow's duplicate-binding pattern.
- [x] 2.2 Run Code Simplifier on the source/test/doc diff; preserve the minimal import-only
  repair.
- [x] 2.3 Update `completion.review` with exact RED/GREEN commands, focused compiler
  results, and limitations; add any discovered follow-up work to root `openspec/TODO.md`.
- [x] 2.4 Strictly validate this OpenSpec change, inspect the final diff, and prepare the
      package for archive and local commit on this task branch.
