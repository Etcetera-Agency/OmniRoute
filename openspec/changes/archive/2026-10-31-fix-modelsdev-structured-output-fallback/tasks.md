# Tasks

- [x] 1. Add actual-resolver regressions for exact canonical cross-provider
      `structured_output=true`, native own-provider `true`/`false` precedence,
      conflicting false rows, row-order independence, and unknown/null behavior.
- [x] 2. Add regressions proving `tool_call` alone is not evidence, exact model IDs do
      not inherit from similar IDs, and the existing known `free/<model>` helper
      resolves the same base identity without promoting a free-prefixed native
      row to its base model.
- [x] 3. Run focused RED tests against the current resolver and record the assertion
      failures.
- [x] 4. Add the minimal common-resolver fallback using existing snapshot/cache
      lookups; retain unknown as `null` and preserve the current native precedence.
- [x] 5. Apply Code Simplifier to the source and test slice, then run focused and
      affected tests plus scoped lint, formatting, and strict OpenSpec validation.
- [x] 6. Update `openspec/TODO.md` and root `completion.review` with local evidence and
      deferred integration/live acceptance. Archive the completed local
      specification change only after the implementation checks pass.
