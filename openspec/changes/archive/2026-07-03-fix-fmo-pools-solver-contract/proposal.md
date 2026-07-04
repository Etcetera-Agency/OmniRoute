# Change: Fix FMO pools solver contract edges

## Why

The solver implements the core global allocation path, but two contract edges can
still produce incorrect or empty plans:

- Pool `quality_band.category` is currently any string, while `model_intelligence`
  only has known task categories. Unknown categories silently resolve to no score.
- The fill ladder's relax step only admits scores below `min`; a score above `max`
  but within `max_delta` is skipped even though the contract says the band relaxes
  on both sides.
- FMO head inventory reads only connection-scoped `syncedAvailableModels`, so a
  runtime/manual model that routes through provider-scoped `customModels` is invisible
  to the pool solver.
- FMO head inventory does not currently apply the normal hidden-model gate, so an
  eye-hidden synced model can still be seated during FMO rebalance.

## What Changes

- Validate `quality_band.category` against OmniRoute's real model-intelligence
  categories at ingest.
- Merge `customModels` into FMO head candidate inventory alongside
  `syncedAvailableModels`; synced-only inventory is not enough for runtime/manual
  models.
- Apply the same hidden-model semantics used by the model catalog:
  `getModelIsHidden(providerId, modelId)` must exclude both synced and custom hidden
  models from FMO head seating.
- Keep the accepted category vocabulary explicit:
  `coding`, `review`, `planning`, `analysis`, `debugging`, `documentation`, `default`.
- Relax the band symmetrically: `[min - max_delta, max + max_delta]`.
- Keep overflow based only on capability surplus, not scores above the max.
- Add regression tests for above-max relaxed candidates and unknown category rejection.

## Implementation Shape

```txt
buildFmoHeadInventory:
  activeConnections = getProviderConnections({ isActive: true })
  customByProvider = getAllCustomModels()
  for connection in activeConnections:
    skip tail-only providers
    synced = getSyncedAvailableModelsForConnection(providerId, connectionId)
    custom = customByProvider[providerId]
    merged = dedupe by model id:
      base = synced model when present else custom model
      fill safe missing fields from custom
    skip if getModelIsHidden(providerId, modelId)
    emit one candidate per providerId + connectionId + modelId
    apply same compat/free/context/capability logic to every source
```

```txt
allowedCategories = coding|review|planning|analysis|debugging|documentation|default

fmoPoolQualityBandSchema.category:
  z.enum(allowedCategories)

relaxed band:
  score != null
  score not in [min,max]
  score in [min - relax, max + relax]
```

```txt
fill ladder:
  exact = hard gates + exact capabilities + in [min,max]
  relaxed = hard gates + exact capabilities + not exact + in [min-relax,max+relax]
  overflow = hard gates + capability surplus + in [min-relax,max+relax]
```

## Impact

- Affected spec: `fmo-pool-rebalance`.
- Affected code: `src/shared/schemas/fmoPools.ts`,
  `src/lib/fmoPools/inventory.ts`, `src/lib/fmoPools/packing.ts`, tests/fixtures if
  they use non-canonical categories.
- Cross-repo dependency: FMO publisher must emit the same canonical category set.
