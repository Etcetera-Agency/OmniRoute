# Change: Complete stability — log kept/displaced, hard account stickiness, no-mix guard

## Why

The "Generation stability" requirement mandates three things the implementation only
partly does:

1. **Record stability outcomes (kept, displaced, dropped).** `solveFmoPools`
   (`src/lib/fmoPools/packing.ts`) only emits `seated` (head/canary) and `dropped`
   (degraded incumbent). It never emits `kept` (incumbent that survived a within-margin
   challenger) or `displaced` (incumbent beaten by a challenger), even though the
   decision schema and `FmoDecisionRecord.outcome` already enumerate them and the spec
   requires them.

2. **Keep a provider/model pinned to its previous `connectionId` while alive.** Account
   stickiness is implemented only as a soft `+0.1` scoring nudge in `sortCandidates`,
   not as the specced **hard** rule (a live, non-exhausted incumbent pin is retained;
   new accounts are added at the margin). A small input shift can still reshuffle a
   healthy pin and strand a half-consumed monthly budget.

3. **Never mix account-pinned and account-unpinned entries for one provider.** This
   holds today only by construction (head candidates always carry a `connectionId`).
   There is no explicit assertion/log, so a future change that introduces an unpinned
   head member would violate the invariant silently.

## What Changes

- `src/lib/fmoPools/packing.ts` — when an incumbent is present and a challenger is within
  the incumbency margin, keep the incumbent and emit a `kept` decision (with the
  challenger + delta in the reason); when a challenger beats the margin, emit `displaced`
  on the incumbent.
- Enforce hard account stickiness: a previous-generation pin that is still eligible
  (in-band, capable, `quota > 0`, account alive) is retained as-is; challengers compete
  only for unfilled demand / new accounts at the margin. Stability still never overrides
  a hard gate (degraded incumbent dropped immediately).
- Add an explicit per-provider no-mix assertion over the built plan: if any provider has
  both pinned and unpinned head members in one generation, log the violation (and fail
  the generation, matching the fail-closed apply rule).

## Impact

- **Capability**: `fmo-pool-rebalance` (Requirement "Generation stability").
- **Reused**: `FmoDecisionRecord` outcomes (`kept`/`displaced` already typed), the
  incumbency-prior loader, `buildPinnedProviderSet`.
- **Net-new**: kept/displaced emission, hard-stickiness retention pass, the no-mix
  assertion+log.
