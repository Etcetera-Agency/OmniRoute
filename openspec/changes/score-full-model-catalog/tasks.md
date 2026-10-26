# Tasks: Score the full models.dev model catalog

## 1. Specification and regression tests

- [x] 1.1 Add the model-catalog scoring requirement and detailed chosen
      algorithm, queue pseudocode, boundaries, and recovery behavior.
- [x] 1.2 Add tests for one-time full-catalog enqueue, later new-model
      enqueue, marker transaction ordering, and duplicate IDs.
- [x] 1.3 Add pure scoring tests for exact identity, supported metrics,
      midranks/ties, singleton cohorts, per-family median, multi-effort median,
      duplicate suppression, two-family minimum, AA scoring, reciprocal fallback,
      and no-evidence unrated behavior.
- [x] 1.4 Add integration tests for bounded drain/resume, strict-SO
      search evidence eligibility, separate benchmark_fitness storage, resolver
      priority, cache invalidation, and manual/Arena preservation.

## 2. Implementation

- [x] 2.1 Add transactional catalog-backfill state and enqueue all current IDs
      once; enqueue only later new IDs.
- [x] 2.2 Cache bounded AA/official source snapshots across catalog work and
      reuse exact matching for each queued model.
- [x] 2.3 Add evidence normalization and model-level coding/general scoring
      from AA, official leaderboards, verified HF records, and exact
      strict-SO-validated search quotes.
- [x] 2.4 Persist derived ratings as `benchmark_fitness`, preserve other
      sources, integrate resolver priority/inheritance, and invalidate fitness
      caches after updates.
- [x] 2.5 Bound each queue drain and persist/resume continuation while work
      remains; record scored and unrated terminal states.
- [x] 2.6 Apply Code Simplifier and update `completion.review`.

## 3. Verification and release

- [x] 3.1 Run focused regression tests and owned-slice diagnostic checks.
- [x] 3.2 Validate the OpenSpec package; record any unavailable validator in
      `completion.review`.
- [x] 3.3 Verify `git diff --check`, score-source priority, no unverified/paid
      route, and preservation of existing manual/Arena ratings.
- [x] 3.4 Commit `openspec/TODO.md` with the implementation and wait for
      independent review.
- [ ] 3.5 Use the authorized PR/main path, run the main image workflow, and
      verify deployed source and one controlled end-to-end score/search.
- [ ] 3.6 Record catalog queue counts, scored/unrated counts, source/image
      fingerprints, search model/route/cost receipts, and remaining work.
