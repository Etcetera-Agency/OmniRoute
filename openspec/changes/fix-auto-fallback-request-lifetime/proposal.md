# Fix Auto fallback request lifetime

## Why

Auto and virtual-band routing resolve an ordered eligible candidate list, but
shared attempt and lifetime guards can end dispatch before every candidate gets
its first attempt. Retries can spend the same attempt budget as untouched
candidates. With `comboTimeoutMs` unset or zero, a hidden ten-minute timer can
also end a long sequence even though each target has its own finite deadline.
Repeated identical model-scoped transient errors can stop heterogeneous Auto
candidates despite proving nothing about their different models.

## What Changes

- For Auto only, dispatch every still-eligible candidate once; configured and
  hard attempt caps bound repeats only.
- Keep the score order, tier/band/capability/budget gates, and strict free-only
  admission unchanged.
- For Auto only, remove the hidden request-global ten-minute cutoff when no
  positive `comboTimeoutMs` is configured. Preserve every finite per-target
  deadline; use the existing finite safety target bound when the effective Auto
  target timeout is disabled or nonpositive.
- Preserve explicit positive `comboTimeoutMs`, client abort, success stop, and
  request-global invalid/cancel stops. Model-scoped transient failures,
  including three identical errors across heterogeneous eligible models, keep
  candidate dispatch alive.
- Add public `handleComboChat` regressions with mocked target responses. No
  production change is part of this phase.
- Ensure upstream `upstream_response_failed` HTTP 504 does not suppress the same
  raw model on an allowed sibling connection without its own cooldown.

## Impact

- Capability delta: `auto-fallback-lifetime`.
- Expected implementation: existing `open-sse/services/combo/comboAttemptLoop.ts`
  counting/deadline gates and existing target timeout resolution/runner only.
- Tests: `tests/unit/auto-fallback-request-lifetime.test.ts`.
- No scoring, eligibility, candidate-order, Non-Auto, retry-after-pass,
  scheduler, or paid-routing changes.
- This phase writes spec and RED regressions only. Parent owns repo TODO and
  root review. Implementation, green focused tests, Code Simplifier review,
  broader checks, archival, and any residual operational acceptance are later
  phases; no commit, push, deployment, or restart is authorized here.

## Current test boundary (2026-10-31)

- Current fork-owned lifetime coverage is in
  `tests/unit/auto-fallback-request-lifetime.test.ts`.
- Upstream stock test files have been restored byte-for-byte to BASE. Prior
  Node results that depended on temporary stock-fixture edits are historical
  diagnostics, not current acceptance. This includes the earlier 499 and
  safety-stop fixture runs; no current pass claim is made for those restored
  files.

## Acceptance

- New integration-path regressions fail on the assigned base for the specified
  lifetime, reserved-attempt, model-scoped error, and stop behavior.
- Existing scored order and all candidate eligibility checks remain the source
  of the Auto target list; no paid target can enter strict free-only requests.
- Change package passes strict OpenSpec validation. Production implementation
  and passing verification remain deferred.
