# Change: Make the overflow ladder step key on rare capability, not AA score

## Why

The "Deterministic fill ladder" requirement defines step 3 as **in-band
higher-capability overflow**: surplus candidates that carry rarer capabilities than the
pool requires, spent on a less-specific pool only after the stricter pools that need
those capabilities are covered. The implementation instead keys this step on the
intelligence score:

```ts
// src/lib/fmoPools/packing.ts
function hasHigherCapability(candidate, pool): boolean {
  const score = candidateQualityScore(candidate, pool);
  return score !== null && score > pool.constraints.quality_band.max; // score, not capability
}
```

So "higher-capability overflow" actually means "score above the band max", which is a
different axis. A high-scoring but capability-equal model is treated as overflow, while a
genuinely rarer-capability surplus model (extra tools/vision) may be missed. The
cross-pool protection the ladder promises (protect rare capabilities over the declared
AA band) is keyed off the wrong dimension.

## What Changes

- `src/lib/fmoPools/packing.ts` — redefine the overflow predicate to mean a candidate
  whose capability set is a **strict superset** of the pool's required capabilities
  (carries capabilities the pool does not require), still passing all hard gates and the
  (possibly relaxed) band. Score continues to order candidates within the step; it no
  longer defines the step.
- Keep the reservation guarantee: overflow candidates are spent on a less-specific pool
  only after stricter pools that require those rarer capabilities are covered (the
  existing pool sort + `used` set already provides this; assert it in tests).
- No change to steps 1-2 (exact-fit, relax) or to hard gates.

## Impact

- **Capability**: `fmo-pool-rebalance` (Requirement "Deterministic fill ladder").
- **Reused**: pool specificity sort, the `used` reservation set, hard-gate checks.
- **Net-new**: the capability-superset overflow predicate replacing the score-threshold
  one.
