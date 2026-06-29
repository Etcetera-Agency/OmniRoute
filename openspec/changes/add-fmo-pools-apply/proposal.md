# Change: Atomic generation apply + rebalance scheduling

## Why

Final slice — the flip from shadow plan to live combos. Apply the solve's per-combo
plan atomically (all combo rows + generation marker + decision log in one
`db.transaction`, `strategy=priority`), fail-closed to the last good generation, and
schedule the rebalance using the existing background-sync job pattern. After this
slice OmniRoute is the single writer of FMO-owned combo rows.

Concept: `OMNI_FMO_FORK_REBALANCE_NOTES.md` ("Generation Apply Atomicity",
"Migration (tail)"), `FMO_OMNIROUTE_POOL_BALANCING_CONCEPT.md` §17.

## What Changes

- `src/lib/fmoPools/rebalance.ts` — orchestrate solve → apply; fail-fast on missing
  combo; apply in one `db.transaction` (`updateCombo` per combo + generation marker
  - `fmo_pool_decisions`); advance incumbency prior only on commit.
- Schedule the rebalance from `instrumentation-node.ts` (arenaEloSync pattern,
  self-gated, non-blocking); add `POST /api/fmo/rebalance` manual trigger.
- Migration note: until applied, the solve runs shadow-only for the diff gate
  (single-writer invariant — exactly one writer per combo).

## Impact

- **Capability**: `fmo-pool-rebalance` (atomic apply, scheduling requirements).
- **Reused**: `combos.ts` `db.transaction` (reorder pattern), `updateCombo`,
  `getComboById`; `arenaEloSync` scheduling pattern.
- **Request hot path**: unchanged — materialized combos are ordinary `priority` combos.
- **Depends on**: `add-fmo-pools-solve-tail`. Completes the OmniRoute data plane.
