# Implementation Tasks

- [x] `src/lib/fmoPools/packing.ts` — replace `hasHigherCapability` (score > band.max)
      with a capability-superset predicate: candidate capabilities ⊋ pool required
      capabilities, still passing hard gates and the (relaxed) band.
- [x] Keep score as the within-step ordering only (via `sortCandidates`); confirm the
      overflow step no longer admits capability-equal candidates merely for a high score.
- [x] Verify the reservation order still covers stricter (rarer-capability) pools before
      overflow spends those candidates elsewhere; add an assertion in tests.
- [x] Tests (`tests/unit/fmo-pools-solve-tail.test.ts`): a capability-equal high-score
      candidate is NOT used as overflow; a strict-superset capability candidate IS used as
      overflow only after the stricter pool that needs it is covered; relax still precedes
      overflow; hard gates never relaxed (existing assertions stay green).
