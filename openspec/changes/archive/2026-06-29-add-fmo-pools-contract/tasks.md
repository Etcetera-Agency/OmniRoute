# Implementation Tasks

- [x] Add `OMNIROUTE_FMO_POOLS_ENABLED` to the feature-flag stack (default off).
- [x] Add `src/shared/schemas/fmoPools.ts` — Zod schema for `fmo-pools/v1` (pools[], demand, constraints incl. `quality_band{category,min,max,relax}`, tail, generation).
- [x] Add migration `0NN_fmo_pools.sql` — `fmo_pool_specs` (+ generation marker).
- [x] Add `src/lib/db/fmoPools.ts` — store/read pool specs and generation marker.
- [x] `src/app/api/fmo/pools/route.ts` — `PUT/POST` require management auth, validate + store; `Idempotency-Key` = generation; gate the contract version; fail-fast on missing referenced combo.
- [x] `src/app/api/fmo/usage/route.ts` — `GET` require management auth and return the per-pool usage backchannel.
- [x] Tests: flag-off no-op; unauthenticated pool writes and usage reads rejected; accept valid; reject unknown/breaking shape; reject missing `min_context_tokens`; missing combo fails generation; error responses sanitized.
