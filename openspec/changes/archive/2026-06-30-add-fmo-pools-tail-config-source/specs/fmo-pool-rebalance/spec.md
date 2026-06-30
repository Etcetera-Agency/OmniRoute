# fmo-pool-rebalance Specification

## MODIFIED Requirements

### Requirement: Config-driven tail

The system SHALL read an approved tail config from a real configured source (a config
file, optionally overridable by an environment path), validated on load, on every combo
rebuild; it SHALL NOT use an always-empty placeholder source. It SHALL filter entries by
the pool's capabilities and context, and append matching entries after the head. Tail
entries SHALL always be account-unpinned and SHALL NOT carry a `connectionId`.
Tail/fallback providers SHALL be a class disjoint from head inventory providers, and the
same config's provider list SHALL be the single source that excludes those providers from
the head inventory snapshot. The tail SHALL NOT be counted as forecast demand capacity
and SHALL be treated as above-quota overflow safety. The system SHALL drop and log any
tail entry whose provider is account-pinned in the same generation's head. A malformed
tail config SHALL be logged and SHALL degrade to an empty tail rather than throwing.

#### Scenario: Approved config entry is appended

- GIVEN an approved tail config with an entry that matches the pool capabilities and context
- WHEN the combo is rebuilt
- THEN the matching entry is appended after the head candidates
- AND it carries no `connectionId`
- AND it does not change the pool's covered-demand calculation

#### Scenario: Tail provider excluded from head from the same source

- GIVEN a provider listed in the approved tail config
- WHEN the head inventory snapshot is built
- THEN that provider is not entered into the head snapshot

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

#### Scenario: Malformed config degrades to empty

- GIVEN an approved tail config that fails schema validation
- WHEN the tail config is read
- THEN the failure is logged
- AND the tail is treated as empty rather than throwing
