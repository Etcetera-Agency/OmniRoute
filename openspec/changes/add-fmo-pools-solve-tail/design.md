# Design — global solve + tail

## One-generation solve

```pseudo
function solve(generation):
  pools = loadStoredPools(generation)
  prior = loadIncumbencyPrior()                  # last applied generation members per combo
  inv   = buildInventory(pools); enrich(inv)     # planning slice: band + quota + cooldown
  expandAccounts(inv)
  pools = sortBy(pools, specificity DESC, scarcity DESC)
  reserveRareForStrictPools(pools, inv)          # strict pools get exact-fit rare first
  plan = {}
  for pool in pools:                             # ONE global pass, never per-pool independent
    members = fillLadder(pool, inv, prior)
    members = seatCanary(members, inv, pool)     # place-first, not counted
    members += buildTail(pool)                   # disjoint, unpinned, uncounted
    plan[pool.combo_id] = members
  return plan                                    # NO write here (apply slice does it)
```

## Fill ladder (reuse scorePool for within-step ranking)

```pseudo
function fillLadder(pool, inv, prior):
  members = []
  s1 = eligible(inv, pool, capabilityExact=true, band=pool.band)
  members += takeUntilCovered(rank(s1, prior), pool.demand)
  if covered(members, pool.demand): return members
  s2 = relaxBand(inv, pool, upto=pool.band.relax.max_delta)   # capability still exact
  members += takeUntilCovered(rank(s2, prior), remaining(pool, members))
  if covered(members, pool.demand): return members
  s3 = higherCapabilityOverflow(inv, pool)                    # only after stricter covered
  members += takeUntilCovered(rank(s3, prior), remaining(pool, members))
  return members
# rank(): autoCombo scorePool factors {quota,health,cost,latency,taskFit,stability,...}
#   stability = incumbency term -> incumbent within margin keeps its seat.
# hard gates (capability, context, free) never relax; only band is soft.
```

## Canary (place-first, not counted)

```pseudo
function seatCanary(members, inv, pool):
  cands = inv.filter(c => quotaTier(c) == 4 and inBand(c, pool.band) and capsOk(c, pool))
  if cands: return [pickOne(cands)] + members      # first seat, known capacity below
  return members
# canary capacity is NOT added to covered-demand math.
```

## Tail (disjoint, unpinned, uncounted)

```pseudo
function buildTail(pool):
  headPinned = providersAccountPinnedInHead(pool.generation)
  out = []
  for e in readTailConfig().entries:
    if not capsOk(e, pool) or not contextOk(e, pool): continue   # strict filter
    if e.provider in headPinned:                  # misconfig guard
      log.warn("tail provider pinned in head, dropping", e); continue
    out.push({ model: e.model, connectionId: null })            # account-unpinned
  return out                                       # not counted as capacity
```

## Decision records

```pseudo
# emitted alongside the plan, written in the apply slice's transaction
{ generation, combo_id, member, role: head|tail|canary,
  outcome: kept|displaced|dropped|seated, reason }
```
