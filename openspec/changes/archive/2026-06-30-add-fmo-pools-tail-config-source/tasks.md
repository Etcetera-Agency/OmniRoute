# Implementation Tasks

- [x] Add an approved-tail config file (e.g. `open-sse/config/fmoTailConfig.ts` or a
      JSON loaded from a configurable path) with entries `{ providerId, modelId,
    capabilities, contextWindow }` and a top-level `providers` list.
- [x] Add a Zod schema for the config under `src/shared/schemas/` and validate on load;
      fail loud (logged) on a malformed config, fall back to empty tail.
- [x] `src/lib/fmoPools/planGeneration.ts` — `readFmoTailConfig()` reads + parses the
      real config instead of returning `EMPTY_TAIL_CONFIG`; keep the `deps.readTailConfig`
      override for tests.
- [x] `src/lib/fmoPools/inventory.ts` — `defaultFmoInventoryDeps.readTailConfig` reads
      the same config's `providers` so head excludes tail providers (single source).
- [x] Tests (`tests/unit/fmo-pools-solve-tail.test.ts`): a configured, capability/context
      matching tail entry is appended after head; a head-pinned tail provider is dropped
      and logged; a tail provider never enters the head snapshot; malformed config →
      empty tail, no throw.
