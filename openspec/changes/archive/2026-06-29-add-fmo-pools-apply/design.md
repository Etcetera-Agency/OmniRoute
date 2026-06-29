# Design — atomic apply + scheduling

## Orchestration + atomic apply (reuse db.transaction + updateCombo)

```pseudo
function rebalance(generation, { shadow = false }):
  pools = loadStoredPools(generation)
  for p in pools:
    if getComboById(p.combo_id) == null: abort("missing combo")   # fail-fast, fail-closed
  plan = solve(generation)                       # solve-tail slice
  if shadow:
    return diffAgainstLive(plan)                  # migration diff gate, no write
  applyAtomic(generation, plan)

function applyAtomic(generation, plan):
  db.transaction(() => {                          # combos.ts reorder pattern
    for (combo_id, members) in plan:
      updateCombo(combo_id, {                     # combos.ts:160
        strategy: "priority",
        models: render(members),                  # connectionId per account-pinned; null for tail
      })
      writeDecisions(generation, combo_id, members)   # fmo_pool_decisions
    writeGenerationMarker(generation)
  })
  # any error -> rollback -> previous generation stays fully live (fail-closed)
  # incumbency prior advances only on commit (it reads the latest generation marker)
```

## Scheduling (reuse arenaEloSync pattern)

```pseudo
# instrumentation-node.ts — self-gated, non-blocking, never fatal
if featureFlag("OMNIROUTE_FMO_POOLS_ENABLED"):
  syncTimer = setInterval(() => rebalance(latestGeneration(), { shadow: false }), intervalMs)
# manual:  POST /api/fmo/rebalance        (management/local-only)
# trigger: a new PUT /api/fmo/pools generation
```

## Migration note (single-writer)

```txt
shadow phase : rebalance(gen, { shadow: true }) -> diff plan vs live fmo-* combos
flip         : rebalance(gen, { shadow: false }) -> OmniRoute becomes the only writer
invariant    : exactly one writer per combo (FMO applier until flip, OmniRoute after)
```
