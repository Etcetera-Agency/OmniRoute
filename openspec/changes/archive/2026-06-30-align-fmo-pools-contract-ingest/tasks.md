# Implementation Tasks

- [x] `src/shared/schemas/fmoPools.ts` — replace `contract` with `contract_version`
      literal `fmo-pools/v1`; make `generated_at` optional; `demand` accepts `consumers`
      and `workload_class` with numeric `requests_per_day`; `constraints` accepts
      `free_only` and `capabilities`; `quality_band` accepts `source`/`metric` and a
      `relax` object `{ max_delta, when }`; `tail` is the intent object
      `{ strategy, mode, compatibility }` (reject array-of-members shape).
- [x] Keep strict rejection of unknown/extra fields and keep `min_context_tokens`
      required (no invented default).
- [x] `src/app/api/fmo/pools/route.ts` — accept `Idempotency-Key` as the payload hash;
      remove the `Idempotency-Key === generation` 409 rule; keep auth, flag, and
      combo-existence gates.
- [x] `src/lib/db/fmoPools.ts` / `src/lib/fmoPools/types.ts` — map a stored spec to
      `FmoPlanningPool`: `workload_class` set; `capabilities` → `required_capabilities`;
      `quality_band.relax.max_delta` → band relax; `free_only` honored; tail intent carries
      no members.
- [x] Tests (`tests/unit/api/fmo-pools-contract.test.ts`): canonical publisher payload
      (with `contract_version`, `workload_class`, `free_only`, `capabilities`, object
      `relax`, tail intent) is accepted; array-of-members `tail` rejected; idempotency keyed
      by payload hash not generation; `workload_class` and band relax survive into the
      mapped planning pool.
- [x] Add a shared golden `fmo-pools/v1` fixture (mirrored with the FMO slice) and
      assert the ingester accepts it verbatim.
