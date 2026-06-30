# Change: Wire the rebalance orchestration (inventory → solve → plan)

## Why

All the planning building blocks exist and are unit-tested, but **nothing connects
them in production**. `buildFmoHeadInventory`, `resolveFmoBand`, `resolveFmoQuota`,
`calculateFmoRequestCapacityPerDay`, and `solveFmoPools` are called only from tests —
a repo-wide grep over `src/` and `open-sse/` finds no non-test caller.

The two real rebalance paths never run the solver:

- `buildDefaultPlan()` (the scheduler path, `src/lib/fmoPools/rebalance.ts`) builds
  `plans = specs.map(spec => [comboId, []])` — **empty** member arrays. A scheduled run
  would materialize empty combos.
- `POST /api/fmo/rebalance` requires the caller to **supply** a fully-formed `plan`
  (head/tail/canary members already computed) and returns `400` without one. But under
  variant 2, computing combo members is OmniRoute's job — there is no one to supply
  them.

So the §5 "Rebalance Materialization" end-to-end flow does not exist: there is no bridge
that turns the head inventory (+ band + quota + capacity) into `FmoSolveCandidate[]`,
runs `solveFmoPools`, and produces an `FmoRebalancePlan`. This change builds that bridge
and runs it from the scheduler and the manual trigger.

## What Changes

- `src/lib/fmoPools/candidates.ts` (net-new) — assemble `FmoSolveCandidate[]` from the
  existing blocks: `buildFmoHeadInventory` → per candidate `resolveFmoBand`
  (score/in-band/relaxed/headEligible) + `resolveFmoQuota` (tier + axes) +
  `calculateFmoRequestCapacityPerDay` (counted capacity) + a combined `score`. Drop
  candidates that fail hard gates here or carry them with a `degraded` flag for the
  solve to drop.
- `src/lib/fmoPools/planGeneration.ts` (net-new) — orchestrate one generation: load the
  accepted spec set + map to planning pools (from the contract-ingest change), load the
  previous committed generation as the `FmoIncumbencyPrior`, read the tail config, call
  `solveFmoPools`, and return an `FmoRebalancePlan` with decisions.
- `src/lib/fmoPools/rebalance.ts` — `buildDefaultPlan()` calls `planGeneration` instead
  of emitting empty arrays. `rebalanceFmoPools` SHALL NOT require an externally supplied
  member list to materialize; the optional `planOverride` stays for tests/dry-run only.
- `src/app/api/fmo/rebalance/route.ts` — manual trigger computes the plan server-side
  (shadow/apply), no required `plan` body.
- Incumbency prior is loaded from the last committed generation; decision log persists;
  apply stays atomic (reuse of the existing transaction).

## Impact

- **Capability**: `fmo-pool-rebalance` (adds "End-to-end rebalance orchestration").
- **Reused**: `buildFmoHeadInventory`, `resolveFmoBand`, `resolveFmoQuota`,
  `calculateFmoRequestCapacityPerDay`, `solveFmoPools`, `buildFmoTail`, `applyPlan`
  (atomic), the generation marker + decision tables.
- **Net-new**: the candidate assembler and the generation orchestrator; loading the
  previous generation as the incumbency prior.
- **Depends on**: `align-fmo-pools-contract-ingest` (it consumes the mapped planning
  pool incl. `workload_class`). **Closes**: the gap where production materializes empty
  combos / demands an external plan.
