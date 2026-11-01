# Implementation tasks

> Final acceptance: 2026-11-01. Earlier holds below are historical and resolved;
> see the final acceptance receipt in `completion.review`.

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
- [x] 9. GitHub release/protected deployment/passive receipt accepted by parent:
      existing run `41247447693`, failed-job-only attempt 2 succeeded at
      `2026-11-01T00:09:11Z`. Source/tasks 1–8, PR57, local 68/68, independent
      review, and corrected P3 historical-ID wording remain accepted. No new
      inference, normalization, queue, or billing gate applies.

## Final acceptance and archive authorization (2026-11-01)

Parent accepted source, prior scoped regressions/reviews, and actual runtime
release `dcc79e26476434ef0e0bcb5d49be50798c58c0fd` on immutable image
`sha256:52d86f2c8b9847088a5e2b37ac7c5a82a429a6f1ff22f6cfed5014ab140407e7`.
Attempt 2 succeeded; the owner selected stock automatic credential-health checks.
Earlier runtime/health holds are resolved. Historical manual inference, queue,
normalization, forced-tool, and billing work remains suspended and is not a
package-closure requirement. This closure ran no source tests or runtime actions.
