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
       live state, exact runtime probe guard, and remaining artifact/runtime gates.
7. [ ] Parent accepts the local result; then continue the already-authorized
       GitHub artifact, deployment, and passive runtime phases without a new
       owner permission gate. Keep this package open until its runtime gates pass.
8. [x] P1 correction: reproduce final-stage omission using actual runtime COPY
       instructions, copy the generated root entry explicitly, and rerun only
       affected fixture tests/checks. Targeted rereview accepted with no findings.
9. [x] Targeted P1 rereview accepted with no findings; local commit authorized.
