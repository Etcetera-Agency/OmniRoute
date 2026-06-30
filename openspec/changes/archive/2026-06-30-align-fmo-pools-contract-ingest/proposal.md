# Change: Align pool ingestion with the canonical fmo-pools/v1 wire contract

## Why

The OmniRoute ingester (`src/shared/schemas/fmoPools.ts`) and the FMO publisher
(`src/fmo/pool_publisher.py::compose_pool_generation`) implemented **two different
`fmo-pools/v1` shapes**. There is no adapter between them, so a real
`PUT /api/fmo/pools` from FMO is rejected with `400 Invalid fmo-pools/v1 payload`.
Both repos' unit tests pass only because each tests its own shape with its own
fixtures — the cross-repo wire contract is covered nowhere (exactly the gap the
concept's §16.8 Golden Seam Tests were meant to close).

Divergences (FMO emits → OmniRoute strict schema expects):

| Field          | FMO emits (canonical, concept §4)                               | OmniRoute currently expects                                                                     |
| -------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| version key    | `contract_version`                                              | `contract`                                                                                      |
| timestamp      | —                                                               | `generated_at` **required**                                                                     |
| `demand`       | `{requests_per_day, consumers, workload_class}`                 | strict `{requests_per_day:int, tokens_per_day?, concurrency?}`                                  |
| `constraints`  | `{free_only, capabilities, min_context_tokens, quality_band}`   | strict `{min_context_tokens, quality_band, required_capabilities, hard_gates, max_latency_ms?}` |
| `quality_band` | `{source, metric, category, min, max, relax:{max_delta, when}}` | strict `{category, min, max, relax:number}`                                                     |
| `tail`         | intent object `{strategy, mode, compatibility}`                 | array of `{provider, model, …}`                                                                 |
| idempotency    | `Idempotency-Key = payload hash`                                | requires `Idempotency-Key === generation` (else 409)                                            |

Two further consequences:

- `workload_class` is never ingested (OmniRoute's schema has no such field anywhere),
  yet `capacity.ts` reads `pool.workload_class` — so the §17 capacity invariant
  (`tokens_per_request = max(workload_class weight, global factor)`) can never receive
  the class through the contract.
- OmniRoute's `tail: array of members` contradicts concept §8 / §17: tail entries come
  from an **OmniRoute config file**, account-unpinned; FMO supplies only tail _intent_.

The canonical shape is the publisher/concept §4 shape — FMO's `pool-spec-publisher`
spec already documents the FMO-owned fields and payload-hash idempotency. This change
makes the **OmniRoute ingester** conform to it.

## What Changes

- `src/shared/schemas/fmoPools.ts` — accept the canonical `fmo-pools/v1`:
  `contract_version` key; `generated_at` optional; `demand` accepts `consumers` and
  `workload_class` (numeric `requests_per_day`); `constraints` accepts `free_only` and
  `capabilities`; `quality_band` accepts `source`/`metric` and `relax` as
  `{max_delta, when}`; `tail` is the intent object `{strategy, mode, compatibility}`,
  not a member array.
- `src/app/api/fmo/pools/route.ts` — idempotency by payload hash; drop the
  `Idempotency-Key === generation` 409 rule.
- `src/lib/db/fmoPools.ts` + `src/lib/fmoPools/types.ts` — map a stored spec to the
  internal `FmoPlanningPool`: `workload_class` → capacity input, `capabilities` →
  `required_capabilities` gate, `quality_band.relax.max_delta` → band relax,
  `free_only` honored. Tail intent carries **no** members.
- Keep the existing invariants intact: per-pool `min_context_tokens` still required (no
  default invented), unknown/breaking shape still rejected, missing combo still fails
  the generation, flag-off still inert.

## Impact

- **Capability**: `fmo-pool-rebalance` (modifies "Pool spec ingestion"; adds
  "Contract-to-planning mapping").
- **Reused**: existing Zod validation, feature flag, management auth, combo-existence
  gate, generation marker store.
- **Net-new**: the spec→planning-pool mapping and the canonical wire shape.
- **Pairs with**: FMO `align-pool-publisher-wire-contract` (locks the same shape with a
  shared golden fixture). **Unblocks**: `wire-fmo-pools-rebalance-orchestration`
  (the mapping it produces is what the solve consumes).
