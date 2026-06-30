# Design: rebalance orchestration

## Context

Building blocks (all exist, unit-tested, no production caller):

- `buildFmoHeadInventory(deps) -> FmoHeadCandidate[]` — active connections × synced
  models, capabilities/context/free, tail providers excluded.
- `resolveFmoBand(candidate, band, deps) -> { score, inBand, relaxed, headEligible }`.
- `resolveFmoQuota(candidate, deps) -> { tier, axes, source, searchSnapshot? }`.
- `calculateFmoRequestCapacityPerDay(axes, pool) -> number | null`.
- `solveFmoPools(pools, candidates, options) -> { plans, decisions }` — fill ladder,
  canary, tail, incumbency.
- `applyPlan` / `rebalanceFmoPools` — atomic apply + shadow diff.

Missing: the two functions that connect them.

## Candidate assembler

```ts
// src/lib/fmoPools/candidates.ts
export async function buildFmoSolveCandidates(
  pools: FmoPlanningPool[],
  deps = defaultDeps
): Promise<FmoSolveCandidate[]> {
  const inventory = await buildFmoHeadInventory(deps.inventory);
  const out: FmoSolveCandidate[] = [];
  for (const head of inventory) {
    // A candidate is scored per the pool category band it could serve. Band is
    // pool-scoped, so resolve against each pool's category; keep the best score and
    // let solveFmoPools apply the pool-specific in-band/relax gates.
    const band = resolveFmoBand(head, bandForCategory(pools), deps.intelligence);
    const quota = await resolveFmoQuota(head, deps.quota);
    const capacityFor = (pool: FmoPlanningPool) =>
      calculateFmoRequestCapacityPerDay(quota.axes, pool);
    out.push({
      providerId: head.providerId,
      connectionId: head.connectionId,
      modelId: head.modelId,
      capabilities: head.capabilities,
      contextWindow: head.contextWindow,
      qualityScore: band.score,
      quotaTier: quota.tier,
      capacityPerDay: capacityFor(/* resolved per pool in solve */),
      score: scoreOf(band, quota),
      degraded: false,
    });
  }
  return out;
}
```

Note: `capacityPerDay` depends on the pool's `workload_class`, so the assembler exposes
capacity as a per-pool function and the solve resolves it when seating into a given
pool — OR the assembler is invoked per pool. Pick the per-pool invocation to keep
`FmoSolveCandidate.capacityPerDay` concrete (simpler than threading a function through
`solveFmoPools`). Quota is resolved once per candidate and reused across pools.

## Generation orchestrator

```ts
// src/lib/fmoPools/planGeneration.ts
export async function buildFmoGenerationPlan(deps = defaultDeps): Promise<FmoRebalancePlan> {
  const marker = getFmoPoolGenerationMarker();
  if (!marker) throw new Error("No accepted FMO pool generation");

  const pools = listFmoPlanningPools(); // mapped specs (contract-ingest change)
  const prior = loadIncumbencyPrior(getFmoAppliedGeneration()); // last committed generation
  const tailConfig = readFmoTailConfig();

  const candidates = await buildFmoSolveCandidates(pools, deps);
  const { plans, decisions } = solveFmoPools(pools, candidates, { tailConfig, prior });

  return { generation: marker.generation, plans, decisions };
}
```

`buildDefaultPlan()` in `rebalance.ts` is replaced by `buildFmoGenerationPlan()`. The
existing `rebalanceFmoPools` keeps shadow/apply and the atomic transaction unchanged;
`planOverride` stays for tests and operator dry-runs only.

## Incumbency prior

`loadIncumbencyPrior(generation)` reads the previously **committed** plan (combo rows or
the persisted decision/plan rows for that generation) into
`FmoIncumbencyPrior.byComboId`. The solve already prefers incumbents via the stability
margin and drops degraded incumbents; this change just supplies the prior that today is
always empty.

## Empty / no-candidate pools

A pool with no eligible head candidate SHALL materialize **tail-only** (config tail
filtered by its gates), SHALL NOT be left with the previous generation's members, and
SHALL log the empty-head outcome. This is distinct from today's bug where _every_ combo
is emptied because the solver never runs.

## Failure semantics

Orchestration runs inside the scheduler's try/catch and the route handler; a failure
SHALL abort the apply and leave the previous committed generation fully live
(fail-closed, reusing the atomic apply). No half-applied generation is exposed.

## Testing

- assembler: inventory→candidate carries band score, quota tier/axes, per-pool capacity;
  tail providers excluded; degraded candidates flagged.
- orchestrator: produces a non-empty plan for a pool with eligible candidates; tail-only
  for a no-candidate pool; loads a non-empty incumbency prior from the last committed
  generation and keeps a live incumbent.
- rebalance: a scheduled run materializes the solved head+tail (not empty combos); the
  manual route computes the plan with no `plan` body; apply stays atomic; abort leaves
  the previous generation intact.
