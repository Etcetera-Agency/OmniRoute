# Implementation Tasks

## Current test boundary (2026-10-31)

- Current fork-owned lifetime coverage is in
  `tests/unit/auto-fallback-request-lifetime.test.ts`.
- Upstream stock test files have been restored byte-for-byte to BASE. Earlier
  Node counts are diagnostic history, not current acceptance; 499 and
  safety-stop results specifically depended on temporary fixture edits.

## Phase 1: SPEC + RED only

- [x] 1.1 Ground current Auto resolution, loop attempt counting, target timeout,
      abort, error stop, aggregate, and route boundary in source and graph.
- [x] 1.2 Write the selected requirement, proposal, source-grounded design, and
      implementation pseudocode; do not present alternative designs.
- [x] 1.3 Add isolated public `handleComboChat` regressions for timeout
      failover, response aggregate, Auto request lifetime, uncapped first attempts,
      retries, transient-error continuation, same-model sibling connections,
      explicit timeout, cancellation, and success stop.
- [x] 1.4 Run strict OpenSpec validation and the focused test file; retain exact
      RED failures as phase evidence.
- [x] 1.5 Return phase evidence and deferred TODO entries; parent updated
      repo-level `openspec/TODO.md` and root `completion.review`.

## Phase 2: production implementation

- [x] 2.1 Add Auto-only repeat accounting at the existing target dispatch and
      retry sites; keep every eligible candidate's first dispatch uncapped and
      preserve Non-Auto total-dispatch accounting.
- [x] 2.2 Remove Auto's implicit request-global ten-minute deadline while
      retaining positive explicit deadlines and finite per-target safety bounds.
- [x] 2.3 Keep identical model-error streaks from stopping heterogeneous Auto;
      retain existing request-global invalid/cancel stops and verify the uncooled
      same-model sibling behavior after one upstream 504.
- [x] 2.4 Apply Code Simplifier review to the production slice and record the
      result in change-local `completion.review`.
- [x] 2.5 Complete focused and relevant routing verification. Corrective Node
      runs historically reported lifetime 19/19, affected routing batch 84/84
      (the previous 83 plus one empty-content regression), 499 cancellation
      7/7, and safety-stop 51/51 after explicit safety-fixture model-lockout
      isolation. These counts predate restoration of the upstream stock test
      files and are not current acceptance. The earlier pre-existing
      safety-failure attribution is withdrawn. Strict-free Vitest verification
      is assigned to another worker; the parent reports bindings restored, and
      this slice does not run Vitest or change dependencies. Retained valid
      strict-free Vitest is 25/25 and UI is 3/3. Final typecheck comparison is
      unchanged baseline: 720 diagnostics/113 files, new 0/removed 0.
- [x] 2.6 Leave HTTP gateway deadline changes to IND004's separate
      `keep-inference-gateway-response-open` package. IND004 owns
      `apiBridgeServer.ts`, `runtimeTimeouts.ts`, and
      `tests/unit/auto-fallback-http-response.test.ts`; this package makes no HTTP
      bridge edits. Cross-package integration is verified by the combined
      five-file fork run, 45/45; external production acceptance remains open.
- [x] 2.7 Review the scoped diff, foreign ownership boundaries, residual tests,
      and maintenance risk; parent-owned root TODO/review updates remain external.
- [x] 2.8 Verify Auto candidate construction against the real provider pool and
      model-lockout state. Parent comparison found 720 baseline errors/113 files versus
      721 feature errors/114 files, including one introduced empty-content union
      diagnostic. This slice corrects its source branch; IND005 owns the final
      full typecheck comparison. No full typecheck runs here.

## Phase 3: archive (deferred)

- [ ] 3.1 Archive only after implementation, all verification gates, review, and
      required parent-owned TODO updates are complete. No archive or commit here.

## Historical corrective continuation (before stock-test restoration)

The prior pre-existing safety-failure attribution was withdrawn based on
historical runs: clean baseline passed 51/51, and feature before fixture
correction passed 32/51. Temporary safety-fixture isolation then reported
51/51. The upstream test file was later restored; this is diagnostic evidence,
not a current pass claim. One genuine new TS2339 in the empty-content
repeat-budget branch was addressed by narrowing before `.result`.
Baseline typecheck is 720 errors/113 files; feature was 721/114. Full comparison
remains with IND005; no full typecheck or Vitest is run in this correction.

- [x] Isolate safety fixture and restore 51/51 without changing Non-Auto policy.
- [x] Add meaningful empty-content/repeat-budget RED cases, fix union branch,
      and verify later success plus complete all-failure aggregate.
- [x] Run lifetime, affected routing batch, 499, safety, scoped lint/format,
      Code Simplifier review, and strict package validation.
