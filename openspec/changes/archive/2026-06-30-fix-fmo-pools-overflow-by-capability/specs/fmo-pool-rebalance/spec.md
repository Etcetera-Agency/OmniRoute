# fmo-pool-rebalance Specification

## MODIFIED Requirements

### Requirement: Deterministic fill ladder

The system SHALL fill each pool by the deterministic ladder: exact-fit in-band, then
relax the AA band within `max_delta`, then in-band higher-capability overflow. Step 3
higher-capability overflow SHALL be defined by capability surplus — a candidate whose
capability set is a strict superset of the pool's required capabilities — and SHALL NOT
be defined by an intelligence score above the band maximum; the score SHALL only order
candidates within a step, not select the step. The system SHALL relax the AA band before
spending higher-capability overflow candidates, and SHALL NOT relax capability, context,
or free gates. Higher-capability overflow SHALL be allowed only after the stricter pools
that need those rarer-capability candidates are covered.

#### Scenario: Relax precedes overflow

- GIVEN a pool underfilled after exact-fit in-band
- WHEN the ladder continues
- THEN the band is relaxed within `max_delta` and refilled before any higher-capability overflow is spent

#### Scenario: Overflow is keyed on capability surplus, not score

- GIVEN a candidate that is capability-equal to the pool but scores above the band maximum
- WHEN the overflow step runs
- THEN that candidate is not admitted as higher-capability overflow
- AND only candidates whose capabilities are a strict superset of the pool's requirements are admitted

#### Scenario: Stricter pool covered before overflow spends its candidate

- GIVEN a rarer-capability candidate needed by a stricter pool
- WHEN a less-specific pool reaches its overflow step
- THEN the candidate is spent on the less-specific pool only after the stricter pool is covered

#### Scenario: Hard gate never relaxed

- GIVEN a pool still underfilled after all ladder steps
- WHEN filling stops
- THEN no candidate that fails capability, context, or free gates is added
