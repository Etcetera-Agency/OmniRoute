# Design: Timeout-scoped exact model lockout

## Source Behavior

The dashboard form keeps a local `DEFAULTS` object. Its `enabled` fallback
and Reset defaults action must match `DEFAULT_MODEL_LOCKOUT_SETTINGS.enabled`.
Keep that local object in the client component; do not add a server import,
shared module, or compatibility layer. The UI regression covers omitted
`enabled`, Reset defaults and its save payload, and an explicit stored `false`.

`DEFAULT_MODEL_LOCKOUT_SETTINGS.errorCodes` already contains 504 and
`baseCooldownMs` is 120000. `resolveModelLockoutSettings` uses the default only
when the operator omits a field, so changing the default `enabled` value
preserves explicit opt-out. `executeTargetAttempt` has two model-lockout write
sites: first transient failure and terminal attempt failure. Both currently
check the same request-scope predicate, enablement, and configured status list.

`isRequestScopedUpstreamFailure` marks `upstream_response_failed` as
request-scoped. `shouldRecordModelLockoutForComboFailure` currently allows
ordinary failures and the synthetic `combo_target_timeout`, but rejects other
request-scoped failures. The synthetic timeout is therefore already eligible
at this seam; default disablement still prevents a write.

## Decision: Narrow Timeout Exception

Extend the predicate with one required `status: number` argument:

```ts
shouldRecordModelLockoutForComboFailure(requestScopedFailure, status, structuredError);
```

The exact eligibility rule is:

1. Non-request-scoped failures retain existing eligibility.
2. Request-scoped `combo_target_timeout` retains existing eligibility.
3. A request-scoped failure with status 504 and structured code
   `upstream_response_failed` becomes eligible.
4. Every other request-scoped failure remains ineligible.

Normalize the structured code for case comparison. Keep all existing
`settings.enabled` and `settings.errorCodes.includes(status)` checks after the
predicate. Pass the observed `result.status` from both production call sites;
update every direct test call. Do not add compatibility overloads or default
arguments.

```text
eligible(requestScoped, status, error):
    if not requestScoped: return true
    if comboTargetTimeout(error): return true
    return status == 504
       and lowercase(error.code) == "upstream_response_failed"

on combo failure:
    if eligible(scopedFailure, result.status, structuredError)
       and lockout.enabled
       and lockout.errorCodes contains result.status:
        recordModelLockoutFailure(provider, connectionId, exactModel, 504, ...)
```

The new exception uses the structured upstream code and exact HTTP status, so
local request validation, local resource/queue failures, and client cancellation
do not qualify. Generic upstream 504s that are not request-scoped already use
the existing eligible branch.

## Exact Scope and Cooldown

Keep the current 5xx default scope: canonical provider, connection ID, and exact
model. Keep the existing in-process lockout maps, expiration, cleanup, and
explicit clear behavior. With no upstream reset hint, the default first
cooldown remains 120 seconds; existing exponential backoff and maximum remain
unchanged. An explicit operator disable or removal of 504 from `errorCodes`
still prevents recording.

## Subsequent Auto Build

`buildPreparedPool` already applies `filterLockoutCandidates` for dispatch.
That filter removes only locked connection IDs; if a model has another usable
connection, it keeps the model with the unlocked IDs. Models without usable IDs
remain unchanged under the existing fail-open behavior. Do not alter that
filter or its account narrowing.

The regression must exercise a fresh Auto candidate build after a real attempt
records the timeout, using isolated local storage and real ModelLockout state.
It must not stub `shouldRecordModelLockoutForComboFailure`,
`filterLockoutCandidates`, or `isModelLocked`. Verify a locked exact tuple is
excluded, sibling model/connection remains eligible, and the tuple returns
after advancing beyond the existing cooldown. If the existing filter fails
this end-to-end check, stop and report the production-file expansion needed
before changing Auto production code.

## Out of Scope

Do not change scoring, Auto selection order, account/connection state, timeout
budgets, request lifetime, failure aggregation, paid fallback, or free-only
policy. The source fix is local behavior only; production acceptance and
cross-process/runtime behavior require separate parent-owned review.
