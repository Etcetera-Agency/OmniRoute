# Implementation Tasks

- [x] Add a failing FMO inventory test proving a model present only in provider `customModels` is emitted as a head candidate for each active provider connection.
- [x] Add a failing FMO inventory test proving `syncedAvailableModels` plus `customModels` are deduped by `(providerId, connectionId, modelId)`.
- [x] Add a failing FMO inventory test proving `getModelIsHidden(providerId, modelId)` excludes hidden synced models from head candidates.
- [x] Add a failing FMO inventory test proving hidden/malformed custom models and tail-only providers are not emitted as head candidates.
- [x] Update `FmoInventoryDeps` and `buildFmoHeadInventory()` to read provider-scoped custom models in addition to connection-scoped synced models.
- [x] Apply model visibility gates, compatibility overrides, token/context metadata, supported endpoints, and free-model catalog matching to both synced and custom candidates.
- [x] Add a failing schema test: `quality_band.category = intelligence` is rejected by OmniRoute.
- [x] Add a fixture/update test using a canonical category such as `default` or `coding`.
- [x] Update `fmoPools` Zod schema to use the canonical model-intelligence category enum.
- [x] Add a failing solve test where a candidate scores above `max` but within `max_delta` and is chosen in the relaxed-band step before overflow.
- [x] Replace the lower-only relaxed predicate with symmetric relaxed-band logic.
- [x] Verify overflow remains capability-surplus based and does not admit same-capability candidates only because their score is above max.
- [x] Update the shared golden fixture only after the FMO-side category slice emits the same category.
- [x] Run targeted tests: `api/fmo-pools-contract`, `fmo-pools-solve-tail`, `fmo-pools-orchestration`.
