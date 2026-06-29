# fmo-pool-rebalance Specification

## ADDED Requirements

### Requirement: Pool spec ingestion

The system SHALL accept a versioned `fmo-pools/v1` generation on a dedicated seam
(`PUT/POST /api/fmo/pools`) behind the `OMNIROUTE_FMO_POOLS_ENABLED` feature flag,
require management authentication for pool writes and usage reads, validate pool
writes against a Zod schema, and store accepted pools. When the flag is off the seam
SHALL be inert and OmniRoute behavior SHALL equal upstream. The system SHALL reject
an unknown or breaking contract shape and SHALL reject a pool that omits a per-pool
context lower bound; it SHALL NOT invent a default context lower bound. The system
SHALL fail the whole generation when any referenced `combo_id` does not exist; it
SHALL NOT create, delete, or synthesize combos. Storing a generation SHALL NOT
materialize or modify any combo.

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

#### Scenario: Valid generation accepted and stored

- GIVEN the flag is on and a well-formed `fmo-pools/v1` payload whose combos all exist
- WHEN the payload is submitted
- THEN every pool is stored with status accepted
- AND the generation marker is recorded
- AND no combo is materialized

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

#### Scenario: Unknown contract shape rejected

- GIVEN a payload with an unknown or breaking field shape
- WHEN it is validated
- THEN it is rejected without storing any pool
