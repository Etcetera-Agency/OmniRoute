# Implementation Tasks

## 1. Proposal and Failing Tests

Historical test-phase results below describe the earlier implementation run.
Stock/upstream test files have since been restored byte-for-byte. Current
fork-owned regression coverage lives only in the paths listed in tasks 1.3–1.7;
historical stock fixtures are not current acceptance.

- [x] 1.1 Review current model-lockout settings, combo failure predicate,
      recording call sites, Auto filter, existing OpenSpec packages, and TODO.
- [x] 1.2 Record the single selected design, explicit boundaries, and
      pseudocode in this package; add requirement scenarios.
- [x] 1.3 Add `tests/unit/fork-model-lockout-settings-default.test.ts` coverage:
      omitted settings enable ModelLockout; explicit `enabled: false` remains
      disabled.
- [x] 1.4 Add attempt-level coverage in
      `tests/unit/fork-auto-timeout-model-lockout.test.ts` for ordinary upstream
      504, request-scoped `upstream_response_failed` 504, and synthetic
      `combo_target_timeout`, each recording exact provider/connection/model.
- [x] 1.5 In the same fork-owned test, prove validation, local queue rejection,
      and client cancellation do not cool a model; prove exact tuple isolation.
- [x] 1.6 In the same fork-owned test, exercise real request failure, recording,
      Auto candidate filtering, sibling eligibility, and restoration after
      cooldown expiry using real lockout state and the real candidate factory.
      Seed fake model availability, capabilities, and pricing locally.
- [x] 1.7 Cover dashboard/backend default parity in
      `tests/unit/ui/model-lockout-defaults.test.tsx`: omitted `enabled`, Reset
      defaults and save payload, plus explicit stored `false` remaining visible
      until Reset defaults. Its RED result is historical; GREEN is recorded in
      `completion.review`.

## 2. Minimal Implementation

- [x] 2.1 Set the default `ModelLockout.enabled` to `true`, preserving explicit
      operator `false` and all existing cooldown/error-code configuration.
- [x] 2.2 Add required HTTP status to
      `shouldRecordModelLockoutForComboFailure`; allow only existing synthetic
      timeout and request-scoped upstream `upstream_response_failed` HTTP 504.
- [x] 2.3 Update real production call sites and affected tests; add no
      compatibility overloads or default-argument shims.
- [x] 2.4 Keep lockout recording on the existing exact 5xx tuple and leave Auto
      filtering, account narrowing, scoring, timeout, and free-only behavior
      unchanged.
- [x] 2.5 Set the dashboard's existing local `DEFAULTS.enabled` to `true`;
      do not import backend settings into the client or add a shared defaults
      abstraction.

## 3. Verification and Local Completion

- [x] 3.1 Preserve pre-implementation RED results as historical evidence in
      `completion.review`; they are not current fork-owned acceptance.
- [x] 3.2 Run current fork-owned resolver, attempt, Auto-build, and timeout
      regressions from `tests/unit/fork-model-lockout-settings-default.test.ts`
      and `tests/unit/fork-auto-timeout-model-lockout.test.ts`; record exact
      command and results in `completion.review`.
- [x] 3.3 Apply Code Simplifier to the completed production and test diff; fix
      any concrete findings and record its result.
- [x] 3.4 Run strict OpenSpec validation and changed-file formatting/diff
      checks; record outputs in `completion.review`.
- [x] 3.5 Mark local implementation status and leave production acceptance,
      root `completion.review`, root `openspec/TODO.md`, integration, and
      archive for their named owners. Do not commit, push, deploy, or restart.
- [x] 3.6 Record historical UI RED and the focused UI GREEN evidence for
      `tests/unit/ui/model-lockout-defaults.test.tsx` in `completion.review`.

## 4. Parent-Owned Follow-up and Acceptance (Pending)

- [x] 4.1 In the separate lifetime phase, test whether a request-scoped
      `upstream_response_failed` 504 suppresses a same-request retry to a
      sibling connection through `requestScopedReplayKey`; make any narrow
      correction only if that test is RED. The current fork-owned regression
      chain covers this case; combined Node acceptance passed 45/45. No
      correction was needed.
- [x] 4.2 Parent updated root `completion.review` and `openspec/TODO.md`; local
      integration receipts are complete. External production acceptance and
      archive remain open and tracked in the root TODO.
