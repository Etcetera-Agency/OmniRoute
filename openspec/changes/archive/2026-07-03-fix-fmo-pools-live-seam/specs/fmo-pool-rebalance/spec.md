# fmo-pool-rebalance Specification

## MODIFIED Requirements

### Requirement: Pool spec ingestion

The system SHALL accept a versioned `fmo-pools/v1` generation on a dedicated seam
(`PUT/POST /api/fmo/pools`) behind the `OMNIROUTE_FMO_POOLS_ENABLED` feature flag,
require management authentication for pool writes, validate pool writes against a Zod
schema, and store accepted pools. When the flag is off the seam SHALL be inert and
OmniRoute behavior SHALL equal upstream.

The API bridge SHALL expose the pool seam methods FMO needs in production:
`PUT /api/fmo/pools` and `POST /api/fmo/pools`, preserving the caller's management
authentication headers. `/api/fmo/usage` SHALL NOT be a required FMO publisher
contract endpoint. The bridge SHALL NOT expose direct legacy FMO combo-write routes as
the production writer path; FMO publishes pool specs and OmniRoute applies combos
internally.

The accepted shape SHALL be the canonical publisher contract: a top-level
`contract_version` literal `fmo-pools/v1`, a `generation` string, an optional
`generated_at`, a required `rebalance` object, and a non-empty `pools` array.
`rebalance.interval_minutes` SHALL be a positive integer cadence chosen by FMO.
Each pool SHALL carry `pool_id`, `combo_id`, a `demand` object whose
`requests_per_day` is any positive finite number and whose optional `consumers` is a
positive integer count alongside an optional `workload_class`, and a `constraints`
object (`free_only`, `capabilities`, `min_context_tokens`, and a `quality_band` intent
with `min`, `max`, `category`, and `relax` of `{ max_delta, when }`), plus a `tail`
intent object. The system SHALL reject unknown or breaking contract shape and SHALL
NOT invent a default context lower bound.

Pool-write idempotency SHALL be keyed by the payload hash supplied as
`Idempotency-Key`, but idempotency SHALL only deduplicate the stored pool generation
record. Every successful `PUT/POST /api/fmo/pools` call SHALL build and apply the
OmniRoute seating plan, even when the payload and accepted generation are identical to
the current stored generation. This preserves a manual rebalance path without a
separate rebalance route. The system SHALL fail the whole generation when any
referenced `combo_id` does not exist; it SHALL NOT create, delete, or synthesize
combos. Storing a generation SHALL immediately build and apply the OmniRoute seating
plan for that generation. The scheduled OmniRoute self-rebalance loop SHALL then
re-apply the latest accepted generation using `rebalance.interval_minutes`.
`POST /api/fmo/rebalance` SHALL be removed; rebalance is an internal OmniRoute
function/job, not an API contract.

The self-rebalance scheduler SHALL reuse OmniRoute's existing startup background
service pattern (`instrumentation-node` plus an internal timer). The system SHALL NOT
introduce a new cron service, queue worker, or external scheduler framework for this
slice. The timer SHALL be inactive until an accepted pool generation exists. After
each successful pool publish, the timer SHALL use the latest
`rebalance.interval_minutes` value for subsequent ticks.

#### Scenario: Bridge accepts pool publish

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is true and management auth is valid
- WHEN FMO calls `PUT /api/fmo/pools` through the API bridge
- THEN the bridge forwards the request to the app route with auth headers intact
- AND the generation is validated, stored, planned, and applied
- AND future self-rebalance uses the published `rebalance.interval_minutes` cadence

#### Scenario: Pool publish applies atomically

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is true
- AND FMO publishes a valid generation with `rebalance.interval_minutes = 60`
- WHEN `PUT /api/fmo/pools` succeeds
- THEN OmniRoute stores the generation and applies the computed combo model seating in the same accepted flow
- AND the next scheduled self-rebalance is based on the same accepted generation and the 60 minute cadence
- AND no `POST /api/fmo/rebalance` route exists

#### Scenario: Identical pool publish still rebalances

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is true
- AND generation `gen-1` is already accepted and applied
- AND OmniRoute runtime state has changed without a new FMO pool payload
- WHEN FMO sends the same `fmo-pools/v1` payload and idempotency key again to `PUT /api/fmo/pools`
- THEN OmniRoute may reuse the stored generation record
- BUT it still rebuilds and applies a fresh seating plan against current runtime state
- AND the response reports the new apply result

#### Scenario: Scheduler uses existing startup timer pattern

- GIVEN OmniRoute starts with background services enabled
- WHEN an accepted FMO pool generation exists with `rebalance.interval_minutes = 60`
- THEN the existing FMO self-rebalance startup service schedules an internal timer for that cadence
- AND no cron service, queue worker, or external scheduler is required

#### Scenario: Pool publish updates scheduler cadence

- GIVEN the FMO self-rebalance scheduler is running for generation `gen-1`
- WHEN `/api/fmo/pools` accepts generation `gen-2` with `rebalance.interval_minutes = 15`
- THEN subsequent self-rebalance ticks use the 15 minute cadence
- AND they rebuild/apply `gen-2` against current OmniRoute runtime state

#### Scenario: Usage endpoint not required

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is true
- AND `PUT /api/fmo/pools` accepts a valid generation
- WHEN `/api/fmo/usage` is absent or disabled
- THEN pool publish is still a valid contract flow
- AND no demand recalibration is expected from OmniRoute usage

#### Scenario: Legacy combo write denied

- GIVEN FMO pool publishing is the active writer path
- WHEN a client calls a legacy direct combo-write route such as `PUT /api/combos/fmo-routing` through the API bridge
- THEN the bridge denies the write
- AND no combo row is modified through that legacy path

## ADDED Requirements

### Requirement: Pool execution diagnostics boundary

The system SHALL expose OmniRoute-owned pool execution data through diagnostics,
decision logs, and rebalance status endpoints, not as FMO demand recalibration input.
Diagnostics MAY include accepted generation, applied generation, shadow diff, decision
log summary, selected model/account counts, quota/cooldown state, and tail fallback
reasons. These endpoints SHALL be read-only, management-auth gated, and feature-flag
gated where they expose FMO pool internals. They SHALL NOT be required by the FMO
publisher pipeline and SHALL NOT describe their output as forecast demand feedback.

#### Scenario: Diagnostics expose execution facts

- GIVEN a pool generation has been applied
- WHEN an operator reads the diagnostics or rebalance status endpoint
- THEN the response can show applied generation, last decision-log summary, selected model/account counts, and tail fallback facts where available
- AND the response is labeled as diagnostics/status data, not demand feedback

#### Scenario: Diagnostics not required for publish

- GIVEN the diagnostics/status endpoint is unavailable
- WHEN FMO publishes a valid `fmo-pools/v1` generation
- THEN publish can still succeed
- AND FMO demand is not recalibrated from missing OmniRoute diagnostics

#### Scenario: Diagnostics stay read-only

- GIVEN a diagnostics/status endpoint is called
- WHEN the route computes execution facts
- THEN no combo rows, pool specs, or generation markers are modified
