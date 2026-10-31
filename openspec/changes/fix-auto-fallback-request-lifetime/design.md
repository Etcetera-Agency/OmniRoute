# Design: Auto fallback request lifetime

## Source-grounded current behavior

The public `handleComboChat` entry and its inner implementation in
`open-sse/services/combo.ts` resolve Auto candidates before entering
`dispatchWithCooldownRetry`. That ordered
list carries existing score order and eligibility decisions. The loop currently
arms `COMBO_LOOP_SAFETY_TIMEOUT_MS` (10 minutes) whenever
`comboTimeoutMs <= 0`; that deadline also aborts in-flight targets and ends the
loop. `executeTargetAttempt` increments `globalAttempts` for every per-target
retry and rejects dispatch after `clampGlobalAttempts(config.maxGlobalAttempts)`.
The retry loop runs inside each target, so retries on early candidates can
consume budget before later candidates receive a first attempt.

`resolveComboTargetTimeoutMsForCombo` uses
`DEFAULT_COMBO_TARGET_TIMEOUT_MS` (120,000 ms) as its base target default. The
default `comboCooldownWait` is enabled with `maxWaitMs` 90,000, `maxAttempts` 5,
and a 300,000 ms budget. Its existing 10,000 ms dispatch buffer raises the
resolved Auto target timeout to 310,000 ms when the upstream ceiling is
600,000 ms. A positive upstream ceiling may cap the resolved timeout. When the
upstream ceiling is disabled, the resolver can return zero. The lower-level
timeout runner then has a disabled branch that dispatches without a local
timer. Auto must preserve the existing finite combo target default and
cooldown-wait floor in that case, using the existing resolver and no new
setting. `COMBO_LOOP_SAFETY_TIMEOUT_MS` (10 minutes) is only a request-loop
backstop, never a per-target bound. The observed 302,249 ms duration fits the
current resolved target default; the process and wait settings at that
observation, and why no next target dispatched, remain unknown. The public
combo signal is passed into the attempt loop;
499 is terminal and prevents later dispatch. Success resolves the loop and
aborts other in-flight targets. `comboRequestMalformed` currently stops after
three identical model errors regardless of whether remaining targets are
heterogeneous. An `upstream_response_failed` HTTP 504 on one connection must
not prevent dispatch of an allowed, uncooled sibling for the same raw model.
This is an observable routing requirement and does not mandate a particular
internal failure classification.

These facts support changing the existing gates only. No new scheduler, retry
phase, scoring, candidate filtering, or fallback list is needed.

## Selected design

### Attempt budget

For Auto, the finite resolved candidate pool bounds first attempts. Every
still-eligible candidate receives one first dispatch even when pool size exceeds
the configured or hard attempt cap. Those caps count repeats only. Non-Auto
retains existing total-dispatch accounting. Keep `state.globalAttempts` as the
count of actual attempt dispatches; the Auto repeat count is separate. Preserve
Auto `comboErrors` across set retries so a later pass that exhausts repeat
budget does not erase first-pass aggregate failures. Keep candidate order and
eligibility unchanged; add no scheduler or second retry phase.

```text
repeatBudget = existing clamped attempt cap
repeatAttempts = state.autoRepeatAttempts ?? 0
dispatchedKeys = state.autoRepeatTargets ?? empty set

at the existing target dispatch seam:
    run existing target gates
    if target execution key has not dispatched:
        add key to dispatchedKeys
    else:
        if repeatAttempts == repeatBudget: skip this repeat
        repeatAttempts += 1
    state.globalAttempts += 1  # actual attempt dispatch count
    dispatch through the existing target attempt path

before each existing inner retry:
    if repeatAttempts == repeatBudget: finish the current target outcome
    repeatAttempts += 1
    continue the existing retry loop

on an Auto set or cooldown retry, reuse dispatchedKeys and repeatAttempts
across the existing loop; retain the same aggregate comboErrors
```

First dispatches do not consume Auto's repeat counter. Every inner, whole-set,
or cooldown redispatch of an already-attempted target consumes one repeat. A
repeat cap may skip an already-attempted target but cannot block a candidate's
first dispatch. Retries stay within existing loop paths; no retries resume
after the finite candidate pass.

### Deadline precedence

For Auto only, a strictly positive `comboTimeoutMs` remains the request-global
deadline. With zero, negative, missing, NaN, or otherwise nonpositive value,
there is no synthetic request-global ten-minute cutoff. Resolve each target's
effective timeout using existing explicit/connection-level precedence. If an
Auto target's effective timeout is disabled or nonpositive, use the existing
finite combo target default through the existing resolver. Its cooldown-wait
floor remains intact: with default settings and a 600,000 ms upstream ceiling,
the effective timeout is 310,000 ms (300,000 ms wait budget plus 10,000 ms
buffer, above the 120,000 ms base). Do not apply a request-loop cap as target
timeout. Add no setting and never dispatch an unbounded target. Non-Auto keeps
current request and target timeout behavior.

```text
isAuto = strategy traits identify Auto (including virtual Auto bands)
requestDeadline = comboTimeoutMs > 0 ? comboTimeoutMs : none
useLoopSafetyDeadline = requestDeadline exists or strategy is not Auto

comboTargetTimeoutMs = existing combo-setup resolver result
targetTimeout = existing effective per-target timeout
if isAuto and targetTimeout is unset or nonpositive:
    targetTimeout = comboTargetTimeoutMs

dispatch target with finite targetTimeout
if useLoopSafetyDeadline:
    keep the existing positive request deadline or Non-Auto safety deadline
else:
    leave the Auto loop-safety promise pending; do not arm a request timer
stop on explicit requestDeadline, real client abort, terminal request-global
invalid/cancel result, or success; otherwise continue existing ordered loop
```

Preserve user-configured positive global deadlines and the upstream client
abort signal. Do not widen a finite target timeout to simulate request lifetime.

### Failure classification and stop behavior

Keep model-scoped transient errors local to their target. Continue after such
errors through heterogeneous Auto models, even when the last three error
signatures match. An `upstream_response_failed` HTTP 504 on one connection must
not prevent dispatch of an allowed, uncooled sibling for the same raw model;
the implementation need not represent this through a particular internal
failure classification. Only a proven request-global invalid or cancel result
may stop the heterogeneous Auto pass. A successful response ends dispatch
immediately. A real client abort must prevent a subsequent dispatch.

Keep all existing candidate resolution and eligibility inputs untouched:
scored order, tier, band, capability, quota/budget, and strict free-only checks.

## Test boundary

New tests exercise public `handleComboChat` with injected `handleSingleModel`
responses, so only upstream transport is mocked. Raw HTTP response lifetime
belongs to the separately owned IND004 continuation and is outside this phase.

## Historical corrective review findings (before stock-test restoration)

Earlier parent baseline comparison found `combo-safety-stop.test.ts` passed
51/51 on the clean baseline and 32/51 in the feature worktree before fixture
isolation. The earlier pre-existing failure attribution was withdrawn. At
that time the safety fixture reused model tuples with `settings: {}`, inheriting
the newly enabled model-lockout default; a temporary explicit disable reported
51 passing cases. The upstream test file was later restored to BASE, so those
fixture results are diagnostic history and not current acceptance. Production
Non-Auto routing continues to honor enabled model lockout.

Parent typecheck comparison identifies one genuine added TS2339 at
`executeTargetAttempt.ts`: the empty-content result is accessed while the
outcome may still have `shouldRetry: true`. Narrow the discriminated union
before accessing `result`. If the helper requests a retry but Auto repeat
budget is exhausted, return the normal failed-target `null`; preserve the
helper-recorded empty-content failure and continue to untouched candidates.

```text
outcome = existing empty-content helper (records failure before returning)
if outcome.shouldRetry:
    if existing repeat budget permits: continue existing retry loop
    return null
return outcome.result
```

Verify empty-response repeat-budget exhaustion through later success and
all-failure aggregation. The parent retains final full typecheck comparison;
this corrective slice does not run it or Vitest.
