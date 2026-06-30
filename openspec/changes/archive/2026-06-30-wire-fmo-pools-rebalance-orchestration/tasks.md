# Implementation Tasks

- [x] `src/lib/fmoPools/candidates.ts` — `buildFmoSolveCandidates(pools, deps)`:
      `buildFmoHeadInventory` → per candidate `resolveFmoBand` + `resolveFmoQuota` +
      `calculateFmoRequestCapacityPerDay` (per pool's `workload_class`) + combined `score`;
      exclude tail providers (already in inventory); flag `degraded` where applicable.
      Resolve quota once per candidate and reuse across pools.
- [x] `src/lib/fmoPools/planGeneration.ts` — `buildFmoGenerationPlan(deps)`: load mapped
      planning pools, load previous committed generation as `FmoIncumbencyPrior`, read tail
      config, call `solveFmoPools`, return `FmoRebalancePlan` with decisions.
- [x] `loadIncumbencyPrior(generation)` — read the last committed generation's members
      into `byComboId` (today the prior is always empty).
- [x] `src/lib/fmoPools/rebalance.ts` — replace `buildDefaultPlan` empty-array body with
      `buildFmoGenerationPlan`; keep shadow/diff and the atomic apply; keep `planOverride`
      for tests/dry-run only.
- [x] `src/app/api/fmo/rebalance/route.ts` — compute the plan server-side; no required
      `plan` body; keep auth, flag, generation-accepted gate; support `shadow`.
- [x] No-candidate pool → tail-only materialization + logged empty-head outcome (not
      stale members).
- [x] Tests (`tests/unit/fmo-pools-orchestration.test.ts`): assembler carries
      band/quota/capacity and excludes tail providers; orchestrator produces non-empty plan
      for eligible pool and tail-only for no-candidate pool; incumbency prior loaded and a
      live incumbent kept; scheduled run materializes solved members (asserts combos are not
      emptied); manual route computes plan with no body; aborted apply leaves previous
      generation live.
