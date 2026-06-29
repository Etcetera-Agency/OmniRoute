# fmo-pool-rebalance Specification

## ADDED Requirements

### Requirement: One-generation global solve

The system SHALL process the published pool set as one batch allocation problem and
SHALL NOT rebalance pools independently inside one generation. It SHALL load the
previous applied generation as an incumbency prior, build one head inventory
snapshot, sort pools by specificity and scarcity descending, and reserve exact-fit
rare candidates for stricter pools before filling less specific pools. The solve
SHALL emit a per-combo materialization plan and SHALL NOT write combos itself.

#### Scenario: Rare candidate reserved for the strict pool

- GIVEN a tools pool and a text pool, and a single tool-capable candidate
- WHEN the global solve runs
- THEN the tool-capable candidate is reserved for the tools pool
- AND the text pool is filled from text-capable candidates first

#### Scenario: Solve is stateful

- GIVEN a previous applied generation exists
- WHEN a new generation is solved
- THEN the previous assignments are loaded as the incumbency prior
- AND the solve is not computed from an empty prior

### Requirement: Deterministic fill ladder

The system SHALL fill each pool by the deterministic ladder: exact-fit in-band, then
relax the AA band within `max_delta`, then in-band higher-capability overflow. It
SHALL relax the AA band before spending higher-capability overflow candidates, and
SHALL NOT relax capability, context, or free gates. Higher-capability overflow SHALL
be allowed only after the stricter pools that need those candidates are covered.

#### Scenario: Relax precedes overflow

- GIVEN a pool underfilled after exact-fit in-band
- WHEN the ladder continues
- THEN the band is relaxed within `max_delta` and refilled before any higher-capability overflow is spent

#### Scenario: Hard gate never relaxed

- GIVEN a pool still underfilled after all ladder steps
- WHEN filling stops
- THEN no candidate that fails capability, context, or free gates is added

### Requirement: Quota-learning canary

The system SHALL seat a no-number calibration candidate first in its combo and SHALL
NOT count its capacity toward demand coverage until its ceiling is observed. The
known capacity built by the ladder SHALL sit below the canary as the absorbing
fallback. The system SHALL NOT treat a quota-learning canary as an unrated-score
canary.

#### Scenario: Canary seated first, not counted

- GIVEN a candidate with no resolvable quota number
- WHEN the pool combo plan is built
- THEN the candidate is placed first in the combo
- AND its capacity is not counted toward the pool's demand coverage
- AND the ladder-built known capacity is placed below it

### Requirement: Generation stability

The system SHALL prefer incumbent candidates over challengers unless a challenger
beats the incumbency margin, and SHALL keep a provider/model pinned to its previous
`connectionId` while that account is alive and not exhausted, adding new accounts at
the margin rather than reshuffling placed pins. Stability SHALL apply only among
eligible candidates and SHALL NOT override capability, context, band, free, or quota
gates; a degraded incumbent SHALL be dropped immediately. The system SHALL NOT mix
account-pinned and account-unpinned entries for the same provider in one generation,
and SHALL record stability outcomes (kept, displaced, dropped) with reasons.

#### Scenario: Incumbent kept within margin

- GIVEN an incumbent member and a challenger that does not beat the incumbency margin
- WHEN the pool is solved
- THEN the incumbent keeps its seat
- AND the decision record marks it as kept

#### Scenario: Degraded incumbent dropped

- GIVEN an incumbent that fell out of band or exhausted its quota
- WHEN the pool is solved
- THEN the incumbent is dropped immediately with no margin
- AND the decision record carries the drop reason

#### Scenario: No mixed pinning per provider

- GIVEN a provider used across several combos in one generation
- WHEN the plan is built
- THEN that provider's entries are either all account-pinned or all account-unpinned

### Requirement: Config-driven tail

The system SHALL read an approved tail config on every combo rebuild, filter entries
by the pool's capabilities and context, and append matching entries after the head.
Tail entries SHALL always be account-unpinned and SHALL NOT carry a `connectionId`.
Tail/fallback providers SHALL be a class disjoint from head inventory providers. The
tail SHALL NOT be counted as forecast demand capacity and SHALL be treated as
above-quota overflow safety. The system SHALL drop and log any tail entry whose
provider is account-pinned in the same generation's head.

#### Scenario: Tail is account-unpinned and uncounted

- GIVEN a pool whose demand is already covered by head candidates
- WHEN the tail is appended
- THEN tail members carry no `connectionId`
- AND the tail does not change the pool's covered-demand calculation

#### Scenario: Tools pool keeps capability in its tail

- GIVEN a tools pool in strict compatibility mode
- WHEN the tail is filtered
- THEN no text-only tail entry is appended
- AND the tools pool never falls to a text-only tail

#### Scenario: Misconfiguration guard

- GIVEN a provider that is account-pinned in this generation's head and also appears in tail config
- WHEN the tail is materialized
- THEN the offending tail entry is dropped
- AND the violation is logged
