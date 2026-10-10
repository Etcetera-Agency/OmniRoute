# Implementation Tasks

1. [x] Add schema tests for string/list rules, operation allowlist, target-ID match and required operation, optional non-target operation, exact-model gate, and unchanged string behavior. Adapter-correction schema and route RED reproduced before implementation.
2. [x] Add dispatch test proving native pinned browser instruction JSON reaches Laya unchanged and outgoing auth/body fields stay on existing contract. Existing dispatch pass-through made this test GREEN before implementation.
3. [x] Add route test proving valid pinned target request dispatches intact and non-pinned object is rejected before dispatch. Adapter-correction route 400 reproduced before implementation.
4. [x] Implement scoped structured instruction validation; all three focused SystemOne test files pass (50/50) and core typecheck passes.
5. [x] Run Code Simplifier on changed implementation; no further simplification was safe or needed. Record review evidence in `completion.review`.
6. [x] Add pending deployment approval and production Browser v19s verification to repo-level `openspec/TODO.md`; keep this change unarchived until operational checks pass.
