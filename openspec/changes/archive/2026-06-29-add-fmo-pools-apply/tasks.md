# Implementation Tasks

- [x] `src/lib/fmoPools/rebalance.ts` — orchestrate solve → apply; fail-fast if any referenced combo is missing.
- [x] Add migration column/table for `fmo_pool_decisions` if not already created in the contract slice.
- [x] Apply in one `db.transaction`: `updateCombo(strategy=priority, models=head+tail)` per combo + generation marker + decision log; fail-closed to last good generation.
- [x] Advance incumbency prior only on commit; never expose a half-applied generation to runtime.
- [x] Shadow mode: `rebalance(gen, {shadow:true})` returns a diff vs live combos and writes nothing (migration diff gate).
- [x] Schedule rebalance from `instrumentation-node.ts` using the `arenaEloSync` pattern (self-gated by the flag, non-blocking, never fatal); daily/twice-daily.
- [x] `src/app/api/fmo/rebalance/route.ts` — `POST` manual trigger (management/local-only).
- [x] Tests: all-or-nothing apply (third write fails ⇒ none change); priority strategy on apply; prior advances only on commit; scheduled run gated by flag; unauthenticated manual trigger rejected; manual trigger applies.
- [x] Add `docs/fmo-fork-boundary.md`; update CHANGELOG (Unreleased).
