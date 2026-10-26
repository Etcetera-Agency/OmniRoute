## ADDED Requirements

### Requirement: Special score sources are free-only

For explicit `:free` bands, the system SHALL prefer the selected-profile
`benchmark_consensus` score, then use `models_dev_tier` when that profile has
no numeric score. It SHALL rate neither source for other tiers, regardless of
custom rated-source lists, and SHALL preserve other configured-source behavior.

#### Scenario: Free benchmark score is inside the selected range

- **GIVEN** a free candidate has a benchmark consensus score in the selected
  task and band profile
- **AND** the score is inside the configured inclusive range
- **WHEN** the task and band predicate evaluates the candidate
- **THEN** the candidate is admitted

#### Scenario: Free benchmark score is outside the selected range

- **GIVEN** a free candidate has a benchmark consensus score for its profile
- **AND** the score is outside the configured range
- **WHEN** the task and band predicate evaluates the candidate
- **THEN** the candidate is excluded without widening the range or trying a
  different band

#### Scenario: Capability fitness fills a missing free profile

- **GIVEN** the selected profile has no numeric score and the candidate has a
  `models_dev_tier` estimate
- **WHEN** an explicit free quality band evaluates the candidate
- **THEN** the capability estimate is compared with that band's range
- **AND** the score source remains identified as `models_dev_tier`

#### Scenario: Capability fitness cannot rate another tier

- **GIVEN** a candidate has a `models_dev_tier` value
- **AND** the request is not an explicit `:free` band
- **AND** a custom rated-source list names `models_dev_tier`
- **WHEN** the band evaluates the candidate
- **THEN** the source is unrated for this request

#### Scenario: Benchmark fitness cannot rate another tier

- **GIVEN** a candidate has a benchmark consensus score
- **WHEN** a paid or non-tiered band request evaluates the candidate
- **THEN** that score is not treated as a rated source

#### Scenario: Benchmark score precedes capability fallback

- **GIVEN** a candidate has both selected-profile benchmark fitness and a
  `models_dev_tier` estimate
- **WHEN** its task fitness is resolved
- **THEN** the benchmark score is returned without blending the capability
  estimate into it

### Requirement: Unrated candidates remain low-only

Candidates without a rated score SHALL remain eligible in `low` without a
synthetic score. They SHALL NOT enter `mid` or `high`.

#### Scenario: No rated source is available

- **GIVEN** a candidate has no score from any source rated for its request
- **WHEN** each quality band evaluates it
- **THEN** it remains available to `low` and is excluded from `mid` and `high`

### Requirement: Each band selects its calculation profile

The system SHALL select `low` for `low`, `medium` for `mid`, and `high` for
`high`. Only that profile's resolved fitness SHALL determine membership.

#### Scenario: Each band uses its corresponding profile

- **GIVEN** a model has different fitness values for low, medium, and high
- **WHEN** each band evaluates the model
- **THEN** low uses low, mid uses medium, and high uses high
- **AND** another profile's score does not affect membership

### Requirement: High uses the mapped effective AA effort

For a candidate, the system SHALL use the effective effort selected by its
Hermes reasoning audit. A mapped `xhigh` row SHALL be used even when a `high`
sibling exists; a mapped `high` row SHALL use `high`. For generic reference
identities without a candidate mapping, the system SHALL prefer `high` and use
`xhigh` only when `high` is absent. It SHALL NOT average both efforts together.

#### Scenario: Candidate mapping selects xhigh

- **GIVEN** the AA API has separate `high` and `xhigh` rows for one model
- **AND** Hermes maps that candidate's high band to `xhigh`
- **WHEN** high-band candidate fitness is calculated
- **THEN** the score comes from the `xhigh` row
- **AND** the `high` row does not affect that score

#### Scenario: Candidate mapping selects high

- **GIVEN** the AA API has separate `high` and `xhigh` rows for one model
- **AND** Hermes maps that candidate's high band to `high`
- **WHEN** high-band candidate fitness is calculated
- **THEN** the score comes from the `high` row
- **AND** the `xhigh` row does not affect that score

#### Scenario: Mapped effort is missing but a sibling exists

- **GIVEN** Hermes maps a candidate's high band to `xhigh`
- **AND** the AA API has a `high` row but no `xhigh` row for that model
- **WHEN** high-band candidate fitness is calculated
- **THEN** the `high` score may be used as a marked estimate
- **AND** it SHALL NOT be reported as an exact `xhigh` rating

#### Scenario: Generic reference has only xhigh

- **GIVEN** a generic AA reference identity has an `xhigh` row and no `high` row
- **WHEN** the high reference population is calculated
- **THEN** the `xhigh` row is used as the reference fallback

### Requirement: Missing effort uses marked evidence proxy

If selected-effort evidence is missing, the system SHALL use a numeric
same-model proxy with provenance when available. Otherwise it SHALL keep the
score `null`; it SHALL NOT invent zero or `.5`.

#### Scenario: Missing effort uses same-model proxy

- **GIVEN** a model has a numeric result at another effort but none at the
  selected profile
- **WHEN** the profile is calculated
- **THEN** a median of that model's available results may be used as a marked
  proxy
- **AND** the score is not set to zero

#### Scenario: No usable profile evidence remains null

- **GIVEN** a model has no numeric exact, effort-neutral, or same-model proxy
- **WHEN** the profile is resolved
- **THEN** its score remains `null`

#### Scenario: Numeric zero is preserved

- **GIVEN** a source reports a measured score of zero
- **WHEN** the profile is calculated
- **THEN** zero remains a numeric result and is not treated as missing

### Requirement: Reasoning capability remains an independent filter

The calculation profile SHALL NOT itself require reasoning capability. The
existing `_reasoning` capability suffix SHALL remain a hard filter when the
request explicitly includes it.

#### Scenario: Score profile does not require reasoning capability

- **GIVEN** a free candidate has a numeric score for the selected profile
- **AND** the channel does not request `_reasoning`
- **WHEN** its quality band evaluates it
- **THEN** lack of advertised reasoning capability does not invalidate the
  score

### Requirement: Fitness is keyed by exact global model ID

The system SHALL resolve benchmark fitness by exact model ID, not
provider-qualified score keys or fuzzy aliases. Provider copies SHALL share
one profile score; conflicts SHALL fail snapshot generation. The score SHALL
preserve profile and source provenance.

#### Scenario: Exact raw model ID resolves its profile score

- **GIVEN** a candidate uses raw model ID `big-pickle`
- **AND** the snapshot has a profile score for `big-pickle`
- **WHEN** task fitness is resolved
- **THEN** that profile score is returned as `benchmark_consensus`

#### Scenario: Provider copies share one model score

- **GIVEN** one raw model ID is reachable through multiple providers
- **AND** all copies agree on its score for the selected profile
- **WHEN** either copy is scored
- **THEN** both resolve to the same global model score

#### Scenario: Conflicting copies fail closed

- **GIVEN** provider copies of one raw model ID have different scores
- **WHEN** the score snapshot is built
- **THEN** generation fails instead of choosing one provider's score

### Requirement: Benchmark votes need enough independent evidence

Each benchmark family vote SHALL use at least five reference model identities.
Coding without AA Coding SHALL require votes from two independent benchmark
families; AA Coding may stand alone.

#### Scenario: Sparse coding evidence does not rate a model

- **GIVEN** a model has one benchmark-family vote and no AA Coding score
- **WHEN** the profile is calculated
- **THEN** coding remains `null`

#### Scenario: Small cohorts do not create a family vote

- **GIVEN** a benchmark/version has fewer than five distinct reference models
- **WHEN** the snapshot is calculated
- **THEN** that benchmark/version contributes no family vote

### Requirement: Missing task score uses reciprocal fallback

If exactly one of coding or general has numeric evidence, the system SHALL use
that score for the missing task. If neither does, both SHALL remain unrated;
numeric zero SHALL be preserved.

#### Scenario: Coding falls back to general and general to coding

- **GIVEN** a model has numeric evidence for only one task
- **WHEN** the profile is calculated
- **THEN** the same score fills the missing task

#### Scenario: Neither task has evidence

- **GIVEN** a model has no numeric evidence for coding or general
- **WHEN** the profile is calculated
- **THEN** both task scores remain `null`

### Requirement: Capability cache follows successful sync

After a successful models.dev sync writes capability rows, the next AutoCombo
tier-fitness lookup SHALL use the new snapshot. Failed and dry-run syncs SHALL
NOT publish one.

#### Scenario: New capabilities are visible after sync

- **GIVEN** AutoCombo has loaded its capability snapshot
- **WHEN** a successful models.dev sync writes updated rows
- **THEN** the next tier-fitness lookup sees them without restart or manual
  cache reset
