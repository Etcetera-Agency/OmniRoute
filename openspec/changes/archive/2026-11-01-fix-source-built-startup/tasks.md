# Implementation Tasks

1. [x] Load overlay packaging context and record the owner's single selected
       design: root startup entry delegates to the source-built isolated overlay.
2. [x] Add RED regressions for source-built entry selection, relative dependency
       resolution, and fail-closed behavior when overlay instrumentation is absent.
3. [x] Add an offline native models.dev startup-chain regression covering saved
       enabled/paused settings, one timer registration, immediate sync, the raw
       zero-price snapshot write, and asynchronous benchmark metadata refresh.
       Fail closed on every fetch outside the fixture allowlist; assert no search
       claim, normalizer, or inference execution.
4. [x] Update the official overlay merger to validate and dispatch the selected
       source-built instrumentation entry without changing Docker build selection
       or official UI artifacts.
5. [x] Run focused tests, the affected models.dev settings tests, scoped lint,
       formatting, strict OpenSpec validation, and diff checks. Review the
       implementation with Code Simplifier.
6. [x] Update `openspec/TODO.md` and `completion.review` with the selected-but-not-
       live state, exact runtime probe guard, and remaining runtime gates.
7. [x] Parent accepted the local source integration and static review of the
       cached ARM64 OCI candidate for source revision
       `dcc79e26476434ef0e0bcb5d49be50798c58c0fd`, image digest
       `sha256:52d86f2c8b9847088a5e2b37ac7c5a82a429a6f1ff22f6cfed5014ab140407e7`.
       In the read-only, network-none filesystem container, the official root
       `server/instrumentation.js` plain-read delegate target
       `../omni-overlay/server/instrumentation.js`, webpack runtime, and
       immediate chunk `58256` were readable. This is static artifact
       acceptance only; no app code was initialized or executed. App startup,
       periodic models.dev activation, and structured-output resolution remain
       runtime gates.
       Protected deployment and passive runtime proof remain open under
       `openspec/TODO.md`. Any retry uses the existing immutable image and waits
       for the owner health-policy answer plus parent execution grant; no new
       source acceptance or build is required.
8. [x] P1 correction: reproduce final-stage omission using actual runtime COPY
       instructions, copy the generated root entry explicitly, and rerun only
       affected fixture tests/checks. Targeted rereview accepted with no findings.
9. [x] Targeted P1 rereview accepted with no findings; local commit authorized.

## Final acceptance and archive authorization (2026-11-01)

Parent accepted source, prior scoped regressions/reviews, and actual runtime
release `dcc79e26476434ef0e0bcb5d49be50798c58c0fd` on immutable image
`sha256:52d86f2c8b9847088a5e2b37ac7c5a82a429a6f1ff22f6cfed5014ab140407e7`.
Attempt 2 succeeded; the owner selected stock automatic credential-health checks.
Earlier runtime/health holds are resolved. Historical manual inference, queue,
normalization, forced-tool, and billing work remains suspended and is not a
package-closure requirement. This closure ran no source tests or runtime actions.
