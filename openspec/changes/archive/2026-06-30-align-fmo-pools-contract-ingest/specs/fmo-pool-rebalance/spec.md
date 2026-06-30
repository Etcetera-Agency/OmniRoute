# fmo-pool-rebalance Specification

## MODIFIED Requirements

### Requirement: Pool spec ingestion

The system SHALL accept a versioned `fmo-pools/v1` generation on a dedicated seam
(`PUT/POST /api/fmo/pools`) behind the `OMNIROUTE_FMO_POOLS_ENABLED` feature flag,
require management authentication for pool writes and usage reads, validate pool
writes against a Zod schema, and store accepted pools. When the flag is off the seam
SHALL be inert and OmniRoute behavior SHALL equal upstream.

The accepted shape SHALL be the canonical publisher contract: a top-level
`contract_version` literal `fmo-pools/v1`, a `generation` string, an optional
`generated_at`, and a non-empty `pools` array. Each pool SHALL carry `pool_id`,
`combo_id`, a `demand` object (`requests_per_day`, with optional `consumers` and
`workload_class`), and a `constraints` object (`free_only`, `capabilities`,
`min_context_tokens`, and a `quality_band` intent with `min`, `max`, a `category`/
metric, and a `relax` of `{ max_delta, when }`), plus a `tail` intent object
(`strategy`, `mode`, `compatibility`). The `tail` field SHALL carry intent only and
SHALL NOT carry explicit tail members; tail entries are resolved from OmniRoute config,
not from the contract. The system SHALL reject an unknown or breaking contract shape
and SHALL reject a pool that omits a per-pool context lower bound; it SHALL NOT invent a
default context lower bound.

Pool-write idempotency SHALL be keyed by the payload hash supplied as `Idempotency-Key`;
the system SHALL NOT require the `Idempotency-Key` to equal the `generation`. The system
SHALL fail the whole generation when any referenced `combo_id` does not exist; it SHALL
NOT create, delete, or synthesize combos. Storing a generation SHALL NOT materialize or
modify any combo.

#### Scenario: Flag off is a no-op

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is false
- WHEN a client calls `PUT /api/fmo/pools`
- THEN the seam returns a disabled response
- AND no combo row is read or written

#### Scenario: Unauthenticated pool write is rejected

- GIVEN the feature flag is on
- WHEN a client without management authentication calls `PUT /api/fmo/pools`
- THEN the request is rejected before validation or storage
- AND no generation marker or pool row is stored

#### Scenario: Canonical publisher payload accepted and stored

- GIVEN the flag is on and a payload with `contract_version: "fmo-pools/v1"`, a
  `demand` carrying `workload_class`, `constraints` with `free_only`, `capabilities`,
  `min_context_tokens`, and a `quality_band` whose `relax` is `{ max_delta, when }`,
  and a `tail` intent object whose combos all exist
- WHEN the payload is submitted
- THEN every pool is stored with status accepted
- AND the generation marker is recorded
- AND no combo is materialized

#### Scenario: Idempotency keyed by payload hash

- GIVEN the flag is on and a valid generation whose `Idempotency-Key` is the payload
  hash and is not equal to the `generation`
- WHEN the payload is submitted
- THEN the write is accepted and not rejected for key/generation mismatch
- AND resubmitting the identical payload with the same hash is idempotent

#### Scenario: Tail members in the contract are rejected

- GIVEN a payload whose `tail` is an array of explicit members rather than an intent
  object
- WHEN it is validated
- THEN it is rejected as an unknown/breaking shape
- AND no pool is stored

#### Scenario: Missing referenced combo fails the generation

- GIVEN a pool referencing a `combo_id` that does not exist in OmniRoute
- WHEN the generation is validated
- THEN the whole generation is rejected
- AND no combo is created and no partial state is stored

#### Scenario: Missing context lower bound rejected

- GIVEN a pool whose constraints omit `min_context_tokens`
- WHEN the generation is validated
- THEN the generation is rejected
- AND no default context lower bound is substituted

## ADDED Requirements

### Requirement: Contract-to-planning mapping

The system SHALL map each stored canonical pool spec into the internal planning pool the
solve consumes, without losing any contract-owned field. It SHALL map `workload_class`
to the capacity factor input so that `tokens_per_request = max(workload_class weight,
global factor)` receives the declared class, and SHALL fall back to the global factor
only when `workload_class` is absent. It SHALL map `constraints.capabilities` to the
required-capability gate, `constraints.min_context_tokens` to the context gate,
`constraints.free_only` to the free gate, and `quality_band` (`min`, `max`, `category`,
`relax.max_delta`) to the band resolution. The mapping SHALL NOT relax capability,
context, or free gates, and SHALL carry the `tail` intent only (no members).

#### Scenario: Workload class reaches the capacity algebra

- GIVEN a stored pool whose demand declares `workload_class`
- WHEN planning capacity is computed for a candidate
- THEN `tokens_per_request` uses `max(workload_class weight, global factor)`
- AND a pool that omits `workload_class` uses the global factor

#### Scenario: Capabilities and band map into the solve gates

- GIVEN a stored pool with `capabilities`, `min_context_tokens`, `free_only`, and a
  `quality_band` with `relax.max_delta`
- WHEN the planning pool is built
- THEN capabilities, context, and free become hard gates
- AND the quality band with its relax delta becomes the soft band
- AND the tail intent carries no members
