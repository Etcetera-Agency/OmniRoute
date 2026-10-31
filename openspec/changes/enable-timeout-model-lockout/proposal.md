# Change: Enable exact model lockout for timeout responses

## Why

`DEFAULT_MODEL_LOCKOUT_SETTINGS` already includes HTTP 504 and a 120-second
base cooldown, but defaults `enabled` to `false`. The combo failure path also
classifies `upstream_response_failed` as request-scoped, which currently keeps
that timeout response out of the model-lockout recorder. A repeated timeout can
therefore remain eligible when a later Auto request builds its candidate pool.

The 2026-10-29 trace contained a 302249 ms NVIDIA 504 followed by an Auto free
route 504 644 ms later. The trace does not establish pool size, remaining
candidates, process identity, or whether the aggregate exhaustion response was
reached. This change corrects the source behavior without claiming a cause for
that specific incident.

## Selected Design

- Make `ModelLockout` enabled when its setting is omitted. Preserve an explicit
  `modelLockout.enabled: false` opt-out and existing error-code, cooldown, and
  backoff settings.
- Keep the dashboard's local defaults in parity with the backend so omitted
  fields and Reset defaults do not present or save a false opt-out. Preserve
  explicit stored `false` until the operator selects Reset defaults.
- Keep the existing request-scoped exclusions. Permit only the already
  supported synthetic `combo_target_timeout` and a recognized upstream
  `upstream_response_failed` with HTTP 504 through the model-lockout predicate.
- Add the required HTTP status argument to
  `shouldRecordModelLockoutForComboFailure`; pass the observed response status
  at each production call site. Add no overload or default-argument shim.
- Let the existing recorder keep its 5xx exact provider/connection/model scope
  and existing 120-second base cooldown, exponential backoff, and maximum.
- Keep Auto pool construction unchanged. Verify that a later real Auto build
  removes the cooled connection/model, preserves sibling model/connection
  eligibility, and restores the target after cooldown expiry.

Predicate pseudocode:

```text
shouldRecordModelLockout(requestScopedFailure, status, error):
    if not requestScopedFailure:
        return true
    if error.code or error.type identifies combo_target_timeout:
        return true
    return status == 504 and lower(error.code) == "upstream_response_failed"

if shouldRecordModelLockout(...) and settings.enabled
   and settings.errorCodes contains status:
    record existing exact 5xx provider/connection/model lockout
```

## What Changes

- Change the default ModelLockout setting and the narrow request-scoped timeout
  eligibility predicate.
- Add fork-owned regression coverage in
  `tests/unit/fork-model-lockout-settings-default.test.ts` and
  `tests/unit/fork-auto-timeout-model-lockout.test.ts`. Cover default-on and
  explicit-off settings, ordinary and structured upstream 504s, synthetic
  target timeout, excluded validation/queue/cancel failures, exact tuple
  isolation, and a real request-to-Auto-build lockout/recovery chain. Seed
  stable fake model IDs, synced availability, capabilities, and pricing locally;
  do not depend on a live provider catalog or token expiry.
- Add the `model-timeout-lockout` OpenSpec capability delta.

## Impact

- Production files: `src/lib/resilience/modelLockoutSettings.ts`,
  `open-sse/services/combo/comboPredicates.ts`, and the necessary call sites in
  `open-sse/services/combo/executeTargetAttempt.ts`.
- Tests: the two fork-owned files above. Existing stock/upstream test files
  were restored unchanged; their temporary fixture edits are not part of this
  change or current acceptance.
- Existing `filterLockoutCandidates`, account narrowing, failure aggregation,
  scoring, timeout budgets, connection state, and free-only policy stay intact.
- Root `completion.review` and `openspec/TODO.md` remain parent-owned. Local
  tests do not establish production acceptance or authorize deployment.

## Non-Goals

- No broader lockout for validation errors, client cancellation, or other
  request-scoped failures.
- No provider-wide breaker, connection cooldown, timeout, request-lifetime,
  scoring, model-selection, or aggregate-response behavior change.
- No Auto filter rewrite, new lockout cache, cross-process synchronization,
  paid fallback change, commit, push, deployment, or restart.

## Acceptance

- Missing ModelLockout settings resolve to enabled; explicit `false` remains
  disabled.
- Dashboard load and Reset defaults show and save `enabled: true`; an explicit
  stored `false` remains visible until reset.
- HTTP 504 is recorded for an ordinary upstream response, for a request-scoped
  `upstream_response_failed` response, and for `combo_target_timeout`, subject
  to the existing configured error-code gate.
- Request-scoped validation, local queue rejection, and client-cancel failures
  do not record lockout.
- The recorder uses existing exact 5xx scope and cooldown policy; sibling
  models and connections remain eligible.
- A subsequent real Auto pool build excludes the cooled tuple and restores it
  after expiry; tests do not replace the lockout predicate or Auto filter with
  mocks.
- The two fork-owned files pass 10/10 cases and strict package validation.
  Stock/upstream test files remain byte-for-byte unchanged; this acceptance
  makes no claim that historical 499 or safety-stop fixtures are repaired.
  Production acceptance remains pending and the change stays unarchived.
