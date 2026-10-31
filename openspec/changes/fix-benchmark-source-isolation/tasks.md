# Implementation tasks

- [x] 1. Record owner-approved A2+B1+C1 behavior, detailed design, scenarios,
      and implementation order before code changes.
- [x] 2. Add offline failing regressions for direct discovery ordering,
      incomplete-source retention, and existing positive-evidence/catalog
      guards.
- [x] 3. Add offline failing regressions for mixed source snapshots, no-op
      partial publication, obsolete-ID deferral, rollback, and post-commit cache
      invalidation.
- [x] 4. Add offline failing regressions for per-row normalization, rejection
      receipts, observation-key replacement, unmatched preservation, and the
      normalized source family mapping.
- [x] 5. Implement discovery fallback ordering and retained source status; run
      Code Simplifier before closing this implementation slice.
- [x] 6. Implement source-isolated snapshot replacement and atomic fitness
      publication; run Code Simplifier before closing this implementation slice.
- [x] 7. Implement independent normalized-row validation and observation-key
      replacement, including the approved source-family mapping; run Code
      Simplifier before closing this implementation slice.
- [x] 8. Run focused offline regressions with mocked source/provider fetches and
      actual SQLite rollback/cache checks, relevant type/lint/format checks,
      strict OpenSpec validation, and diff checks. Record outcomes in this
      package and root completion.review.
- [ ] 9. Keep root openspec/TODO.md current with GitHub build and runtime
      acceptance gates. Leave this package unarchived until the parent handles
      integration and those gates are resolved. Independent sequential review
      is complete; its P3 historical-ID documentation finding is corrected.
