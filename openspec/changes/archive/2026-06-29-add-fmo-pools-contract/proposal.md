# Change: Accept the fmo-pools/v1 contract (seam + storage)

## Why

First slice of the omni-fmo data plane. Before OmniRoute can materialize anything it
needs a flag-gated seam that accepts, validates, and stores a published
`fmo-pools/v1` generation. No materialization here — this slice is inert until
later slices read the stored specs. Keeping it separate lets FMO start publishing
(shadow) while the solve/apply are still being built.

Concept: `omniroute-pool-migration-concept/docs/FMO_OMNIROUTE_POOL_BALANCING_CONCEPT.md`
(§4 contract, §17 invariants), `OMNI_FMO_FORK_REBALANCE_NOTES.md`.

## What Changes

- Add `OMNIROUTE_FMO_POOLS_ENABLED` feature flag (default off; off ⇒ upstream).
- Add `src/shared/schemas/fmoPools.ts` — Zod schema for `fmo-pools/v1`.
- Add `src/lib/db/fmoPools.ts` + migration — `fmo_pool_specs` storage and a
  generation marker (DB module only; Hard Rule #5).
- Add management-auth-gated `PUT/POST /api/fmo/pools` (validate + store,
  `Idempotency-Key` = generation, version-gated contract acceptance) and
  management-auth-gated `GET /api/fmo/usage` (per-pool backchannel).

## Impact

- **Capability**: `fmo-pool-rebalance` (ingestion requirement only in this slice).
- **New code**: schema, db module + migration, two API routes, flag.
- **No materialization**: stored specs are not yet read; no combo is touched.
- **Depends on**: nothing. **Unblocks**: `add-fmo-pools-planning`.
