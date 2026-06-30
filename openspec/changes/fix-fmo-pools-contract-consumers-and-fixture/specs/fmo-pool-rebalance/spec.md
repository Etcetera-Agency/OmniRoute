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
`combo_id`, a `demand` object whose `requests_per_day` is any positive finite number
(integer or fractional) and whose optional `consumers` is a positive integer count (not
a list) alongside an optional `workload_class`, and a `constraints` object (`free_only`,
`capabilities`, `min_context_tokens`, and a `quality_band` intent with `min`, `max`, a
`category`/metric, and a `relax` of `{ max_delta, when }`), plus a `tail` intent object
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

#### Scenario: Consumers count accepted as a number

- GIVEN a valid generation whose `demand.consumers` is the integer count `4`
- WHEN the payload is validated
- THEN it is accepted without coercion
- AND a `demand.consumers` given as a string array is rejected as a breaking shape

#### Scenario: Fractional requests_per_day accepted

- GIVEN a valid generation whose `demand.requests_per_day` is a fractional number
- WHEN the payload is validated
- THEN it is accepted without rejection or truncation

#### Scenario: Flag off is a no-op

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is false
- WHEN a client calls `PUT /api/fmo/pools`
- THEN the seam returns a disabled response
- AND no combo row is read or written

#### Scenario: Missing referenced combo fails the generation

- GIVEN a pool referencing a `combo_id` that does not exist in OmniRoute
- WHEN the generation is validated
- THEN the whole generation is rejected
- AND no combo is created and no partial state is stored

## ADDED Requirements

### Requirement: Shared contract fixture conformance

The system SHALL keep one canonical `fmo-pools/v1` golden fixture that is byte-identical
to the copy used by the FMO publisher, and SHALL use it as the single source of contract
truth on both sides. A conformance test SHALL load that fixture and assert the ingester
accepts it verbatim, with no field coercions, so any shape drift between the publisher
and the ingester fails a test rather than failing silently in production.

#### Scenario: Canonical fixture is accepted verbatim

- GIVEN the shared canonical `fmo-pools/v1` fixture
- WHEN it is validated against the ingestion schema
- THEN validation succeeds with no coercion
- AND the fixture bytes match the FMO publisher's copy of the same fixture

#### Scenario: Drift from the fixture fails a test

- GIVEN a change to either side's contract shape that diverges from the shared fixture
- WHEN the conformance test runs
- THEN the test fails
