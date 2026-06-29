# Change: Build the rebalance planning inputs (inventory, band, quota, capacity)

## Why

Second slice. With stored pool specs available, build the read-only planning inputs
the solve will consume: the head inventory snapshot, the model-intelligence band
resolution, the quota source precedence, and the request-equivalents capacity
comparator. This is the "ground truth" layer — mostly reuse of existing OmniRoute
primitives — and is independently testable without any combo write.

Concept: `OMNI_FMO_FORK_REBALANCE_NOTES.md` ("Reusable OmniRoute Primitives",
"Model Intelligence Band", "Quota Ownership And Canary", "Capacity Unit Ownership").

## What Changes

- `src/lib/fmoPools/inventory.ts` — head snapshot from active connections + synced
  catalog + capabilities + free status; excludes tail providers; expands multi-account.
- `src/lib/fmoPools/intelligence.ts` — band resolution via `getResolvedTaskFitness`.
- `src/lib/fmoPools/quota.ts` — quota adapter + source precedence (live → static
  → search → none).
- `src/lib/fmoPools/capacity.ts` — request-equivalents/day comparator + global
  `tokens_per_request` learning loop.

## Impact

- **Capability**: `fmo-pool-rebalance` (inventory, band, quota+capacity requirements).
- **Reused**: `getProviderConnections`, `getSyncedAvailableModels*`, models.dev
  capabilities/`limit_context`, `getModelCompatOverrides`, `freeModelCatalog`,
  `getResolvedTaskFitness`, `getUsageForProvider`, `getProviderLimitsCache`.
- **Net-new**: normalized quota adapter, search-research tier 3 (relocated from
  FMO), the request-equivalents comparator, the `tokens_per_request` learning
  loop (seed 2000).
- **Depends on**: `add-fmo-pools-contract`. **Unblocks**: `add-fmo-pools-solve-tail`.
