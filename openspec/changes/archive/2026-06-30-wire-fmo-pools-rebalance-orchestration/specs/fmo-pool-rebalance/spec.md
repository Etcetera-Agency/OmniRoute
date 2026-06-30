# fmo-pool-rebalance Specification

## ADDED Requirements

### Requirement: End-to-end rebalance orchestration

The system SHALL compute a rebalance plan server-side by connecting the existing
planning blocks into one pipeline: build the head inventory, resolve each candidate's
intelligence band, resolve its quota by source precedence, compute its
request-equivalent capacity, assemble the solve candidates, and run the one-generation
global solve to produce the plan and decision log. A scheduled run and a manual trigger
SHALL both run this full pipeline. The system SHALL NOT require an externally supplied
list of combo members to materialize a generation, and SHALL NOT materialize empty
combos when an accepted generation exists. The solve SHALL load the previous committed
generation as the incumbency prior (it is not stateless), persist the decision log, and
apply atomically; when an apply aborts, the previous committed generation SHALL remain
fully live. A pool with no eligible head candidate SHALL materialize tail-only and SHALL
log the empty-head outcome, rather than retaining stale members.

#### Scenario: Scheduled run materializes a solved plan

- GIVEN an accepted generation and active connections with eligible candidates
- WHEN the scheduled rebalance runs
- THEN OmniRoute builds the head inventory, resolves band/quota/capacity, and runs the
  solve to produce head + tail members
- AND it materializes the solved members, not empty combos

#### Scenario: Manual trigger computes the plan server-side

- GIVEN an accepted generation
- WHEN `POST /api/fmo/rebalance` is called without a supplied plan body
- THEN OmniRoute computes the plan from inventory and the solve
- AND it does not reject the request for a missing plan

#### Scenario: Incumbency prior is loaded from the last committed generation

- GIVEN a previously committed generation with placed members
- WHEN the next generation is solved
- THEN the previous members are loaded as the incumbency prior
- AND a still-eligible incumbent is kept under the stability margin

#### Scenario: No-candidate pool materializes tail-only

- GIVEN a pool whose constraints exclude every head candidate
- WHEN the generation is solved and applied
- THEN the pool materializes only its compatible config tail
- AND the empty-head outcome is logged
- AND the pool does not retain the previous generation's members

#### Scenario: Aborted apply keeps the previous generation live

- GIVEN a computed plan whose apply fails partway
- WHEN the transaction aborts
- THEN no combo is left half-applied
- AND the previously committed generation remains fully live
