# Change: One-generation global solve + config-driven tail

## Why

Third slice — the allocation brain. With planning inputs available, compute one
global solve per generation: deterministic fill ladder, cross-pool reservation,
incumbency stability, place-first quota-learning canary, and the capability-filtered
config-driven tail. This slice produces a materialization **plan** only; the atomic
write is the next slice, so the solve can be shadow-run and diffed before any combo
is touched.

Concept: `FMO_OMNIROUTE_POOL_BALANCING_CONCEPT.md` §17, `OMNI_FMO_FORK_REBALANCE_NOTES.md`
("Global Packing", "Fill Ladder", "Generation Stability", "Config-Driven Tail").

## What Changes

- `src/lib/fmoPools/packing.ts` — sort pools by specificity/scarcity; reserve rare
  exact-fit candidates; fill ladder (exact-fit → relax band → higher-cap overflow);
  within-step ranking via autoCombo `scorePool`; incumbency margin = `stability`
  factor; account stickiness; place-first canary.
- `src/lib/fmoPools/tail.ts` — read approved tail config; capability/context filter;
  account-unpinned; disjoint-class guard; never counted as capacity.
- The solve emits a per-combo plan (`head + tail`) and decision records; it does not
  write combos.

## Impact

- **Capability**: `fmo-pool-rebalance` (global solve, fill ladder, canary, stability,
  config-driven tail requirements).
- **Reused**: autoCombo `scorePool`/`calculateScore`, `combo.ts` reset-aware scoring,
  cooldown/breaker/lockout reads for eligibility.
- **Net-new**: ladder + reservation control flow, tail config + disjoint guard.
- **Depends on**: `add-fmo-pools-planning`. **Unblocks**: `add-fmo-pools-apply`.
