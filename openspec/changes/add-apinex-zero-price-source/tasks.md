# Implementation tasks

> Historical local work only. Superseded before release by
> `generic-compatible-model-metadata` on 2026-10-29; checked tasks and the
> completion receipt record prior work, not current normative scope or release
> acceptance. Keep this package unarchived until the replacement is accepted.

## 1. Proposal and failing tests

- [x] 1.1 Add parser tests using the official `/api/public/models` field names
      and value types; reject missing, empty, duplicate, string, negative,
      mixed-price, and incomplete records without using display labels or ID
      prefixes.
- [x] 1.2 Add node-binding tests for exact OpenAI-compatible type, exact APInex
      endpoint, current synced raw model IDs, and rejection of display-name or
      prefix-only matches.
- [x] 1.3 Add failing persistence/composition tests for separate source URL and
      fetch time, independent 36-hour freshness, oldest included timestamp,
      future/stale boundaries, read-time recomposition, and failure preserving
      prior source state.
- [x] 1.4 Add failing models.dev-save regression proving exact APInex zero
      pricing survives replacement of the models.dev namespace without
      refreshing APInex source provenance.

## 2. Implementation

- [x] 2.1 Add the focused APInex structured catalog parser and configured-node
      adapter; intersect exact IDs with existing synced available IDs only.
- [x] 2.2 Persist one current APInex source snapshot and merge its exact zero
      rows into existing `models_dev_pricing` writes.
- [x] 2.3 Compose fresh source snapshots inside the existing synchronous zero
      price evidence reader; leave `strictZeroCostFilter.ts` unchanged.
- [x] 2.4 Apply Code Simplifier and record source, diff, tests, and review in
      this package's `completion.review` plus the owning benchmark review.
- [x] 2.5 Complete an independent source/code review and resolve concrete
      findings.

## 3. Verification and remaining acceptance

- [x] 3.1 Run focused zero-price and models.dev sync tests; run strict OpenSpec
      validation and changed-file formatting checks.
- [x] 3.2 Confirm models.dev sync still succeeds when the public APInex source
      fails, and the failed source does not refresh stored APInex evidence.
- [x] 3.3 Update `openspec/TODO.md` with the remaining combined TL322/TL324
      native free-only acceptance. Do not claim runtime, completion, or
      production acceptance from these offline source tests.
