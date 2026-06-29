# fmo-pool-rebalance Specification

## ADDED Requirements

### Requirement: Atomic generation apply

The system SHALL update existing combo members/config only after the whole
generation validates, and SHALL set FMO-owned combos to `priority` strategy during
apply. It SHALL apply a generation atomically: all combo rows, the generation
marker, and the decision log commit in one transaction or none do. On any apply
error it SHALL keep the previous generation fully live and untouched (fail-closed),
SHALL NOT expose a half-applied generation to runtime, and SHALL advance the
incumbency prior only on a committed generation.

#### Scenario: All-or-nothing apply

- GIVEN a generation that rewrites three combos
- WHEN the third combo write fails inside the transaction
- THEN none of the three combos are changed
- AND the previous generation stays fully live

#### Scenario: Priority strategy on apply

- GIVEN an accepted generation
- WHEN it is applied
- THEN each referenced combo is written with `strategy = priority`
- AND its members are the head followed by the tail

#### Scenario: Prior advances only on commit

- GIVEN an apply that aborts and rolls back
- WHEN the next generation solves
- THEN the incumbency prior is still the last committed generation

#### Scenario: Shadow apply writes nothing

- GIVEN a stored generation and shadow mode
- WHEN the rebalance runs in shadow
- THEN a plan/diff is produced
- AND no combo row is modified

### Requirement: Rebalance scheduling

The system SHALL run scheduled rebalance once or twice per day plus manual and
new-generation triggers, initialized from the existing startup background-job path,
self-gated by `OMNIROUTE_FMO_POOLS_ENABLED`, non-blocking, and never fatal.

#### Scenario: Scheduled run is gated

- GIVEN the flag is off
- WHEN the startup background path initializes
- THEN no rebalance timer is started

#### Scenario: Manual trigger

- GIVEN the flag is on and a stored generation
- WHEN an operator calls the manual rebalance trigger
- THEN the global solve runs and applies atomically
