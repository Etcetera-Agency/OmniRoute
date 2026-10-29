## ADDED Requirements

### Requirement: Exact free-prefix benchmark identity inheritance

The task-fitness resolver SHALL inherit existing canonical fitness sources for
a raw model ID beginning with the literal `free/` only when its complete
remainder is an exact provider-registry model ID. It SHALL use the existing
source priority, score-expiry and retirement checks, profile selection, and
`<source>:inherited` provenance. It SHALL NOT change score formulas or write
provider-specific copies.

#### Scenario: Exact free ID inherits coding and general scores

- **GIVEN** raw ID `free/muse-spark-1.3` and exact canonical base
  `muse-spark-1.3`
- **AND** canonical global fitness rows exist for `coding` and `general`
- **WHEN** fitness is resolved for the free-prefixed ID
- **THEN** each result equals the existing base result
- **AND** the source is tagged `:inherited`

#### Scenario: Profile score and source priority stay unchanged

- **GIVEN** the canonical base has a selected-profile score and any higher
  priority manual/Arena score
- **WHEN** fitness is requested for the free-prefixed ID and that profile
- **THEN** the existing direct-then-inherited source priority is preserved
- **AND** a profile does not leak into another profile

#### Scenario: Unknown or prefix-only base gains no score

- **GIVEN** the free-prefixed remainder has no exact registry ID, even when it
  is a prefix or basename of one or more known model IDs
- **WHEN** fitness is resolved
- **THEN** no canonical source is inherited
- **AND** generic effort, alias, and slash-basename resolution is not attempted

#### Scenario: Exact base wins over longer prefix matches

- **GIVEN** `kimi` and longer Kimi model IDs are in the provider registry
- **WHEN** fitness is resolved for `free/kimi`
- **THEN** only the exact `kimi` score may be inherited
- **AND** the longer IDs SHALL NOT be considered

#### Scenario: Expired canonical score stays expired

- **GIVEN** the exact canonical base has an expired Arena or override row
- **WHEN** fitness is resolved for its free-prefixed raw ID
- **THEN** the expired row is ignored by the existing database/resolver rules
- **AND** no replacement score is invented
