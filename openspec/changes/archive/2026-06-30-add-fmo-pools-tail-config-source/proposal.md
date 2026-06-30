# Change: Give the config-driven tail a real approved-tail source

## Why

The "Config-driven tail" requirement says the system "SHALL read an approved tail
config on every combo rebuild, filter entries by the pool's capabilities and context,
and append matching entries after the head." The materializer (`src/lib/fmoPools/tail.ts`)
and the disjoint/uncounted/unpinned guards are built and unit-tested — but **no real
config is ever read**:

- `src/lib/fmoPools/inventory.ts` → `readTailConfig: () => ({ providers: [] })`
- `src/lib/fmoPools/planGeneration.ts` → `readFmoTailConfig()` returns
  `EMPTY_TAIL_CONFIG = { entries: [] }`

So in production the tail is always empty: the overflow-safety layer the concept calls
for (e.g. `openrouter-free`) never materializes. The mechanism exists; the source does
not.

## What Changes

- Add an approved-tail config source (a JSON/TS config file, e.g.
  `open-sse/config/fmoTailConfig.*`, optionally overridable by env path) describing
  approved fallback entries: `providerId`, `modelId`, `capabilities`, `contextWindow`.
  Tail providers stay a class disjoint from head inventory providers.
- Replace the two empty stubs with a real reader that loads + parses (Zod-validated)
  this config; keep the dependency-injection seam so tests can still pass an in-memory
  config.
- Feed the same config's `providers` list into `buildFmoHeadInventory`'s
  `readTailConfig` so tail providers are excluded from the head snapshot (one source of
  truth, no drift between the two readers).
- No change to `buildFmoTail` logic, the disjoint-class guard, or the uncounted/unpinned
  rules — only the source wiring.

## Impact

- **Capability**: `fmo-pool-rebalance` (Requirement "Config-driven tail").
- **Reused**: `buildFmoTail`, the head-pinned-provider guard, the inventory exclusion
  seam.
- **Net-new**: the approved-tail config file + Zod schema + the real reader replacing
  both empty stubs.
