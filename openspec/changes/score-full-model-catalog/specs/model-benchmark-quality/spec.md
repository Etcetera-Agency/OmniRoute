# Model benchmark quality

## Requirements

### Requirement: Full models.dev catalog backfill

The system MUST enqueue each unique exact model ID in the current models.dev
catalog once for benchmark evidence and MUST enqueue exact new model IDs on
later successful non-dry-run syncs.

#### Scenario: Existing capability snapshot is already populated

- **WHEN** a successful sync sees no catalog-backfill marker
- **THEN** it MUST enqueue all current exact model IDs before replacing the
  capability snapshot and commit the marker atomically with those queue rows
- **AND** repeated syncs MUST NOT create duplicate queue rows

#### Scenario: A later model appears

- **WHEN** a successful sync sees an exact ID absent from the previous
  capability snapshot after the catalog backfill marker is set
- **THEN** it MUST enqueue that ID before replacing the snapshot
- **AND** it MUST leave all pre-existing model scores untouched until eligible
  evidence is collected

### Requirement: Resumable complete catalog processing

The system MUST process queued catalog models in bounded batches, persist
progress, and continue processing while eligible work remains.

#### Scenario: Batch limit is reached

- **WHEN** one drain reaches its batch limit while eligible rows remain
- **THEN** it MUST persist each processed row and schedule a later drain
- **AND** a process restart MUST resume from the durable queue

#### Scenario: Shared source snapshots are reused

- **WHEN** multiple queued models are compared during one valid AA/official
  source snapshot period
- **THEN** the system MUST fetch each shared source once per snapshot and
  locally match exact IDs for every model
- **AND** source failure or incomplete pagination MUST remain distinguishable
  from an exact miss

### Requirement: Evidence-based global and effort-profile scores

The system MUST calculate global `coding` and `general` fitness for generic
Auto routing and separate low, medium, and high profile fitness for band
selection, using only supported, exactly matched, numeric evidence. It MUST
leave a score unrated when neither task has usable evidence or an allowed
fallback.

#### Scenario: Observations span multiple efforts and versions

- **WHEN** exact observations exist for more than one reasoning effort,
  benchmark version, or configuration
- **THEN** the system MUST normalize them within their comparable cohort and
  combine available observations by median for global fitness
- **AND** a missing effort/configuration MUST contribute no value and MUST NOT
  become zero

#### Scenario: Band profile selects effort without capability gating

- **WHEN** a band requests `low`, `medium`, or `high` profile fitness
- **THEN** the system MUST calculate it from low, medium, or high effort
  observations respectively
- **AND** high profile MUST prefer `xhigh` observations per model and use
  `high` when that model has no `xhigh` observations
- **AND** it MUST NOT exclude or zero a model because reasoning capability or
  effort metadata is absent
- **AND** profile scores MUST be stored separately as
  `benchmark_fitness:<profile>`

#### Scenario: Requested profile effort is missing

- **WHEN** a model has no observation for the requested profile in a
  comparable cohort
- **THEN** it MUST use that model's unknown-effort observations when available
- **AND** otherwise it MAY use that model's available observations from other
  efforts as a same-model proxy, marked low confidence
- **AND** it MUST never turn missing effort into zero
- **AND** if no observation can support the profile score, it MUST omit that
  profile row so existing score sources can resolve the model

#### Scenario: Benchmark-family aggregation

- **WHEN** eligible observations include multiple benchmark versions or
  reasoning efforts in the same family
- **THEN** coding fitness MUST use the median of AA Coding plus at most one
  vote from each of SWE-bench, Terminal-Bench, and DeepSWE
- **AND** one verified benchmark-family vote without AA Coding MAY produce a
  provisional low-confidence coding score when its peer cohort has at least
  two exact models
- **AND** a singleton peer cohort MUST produce no percentile

#### Scenario: Reciprocal task fallback

- **WHEN** exactly one of coding or general has supported fitness
- **THEN** the system MUST copy that value to the missing task
- **AND** it MUST record which task was used as the fallback

#### Scenario: No comparable measurements

- **WHEN** a model has no supported direct measurements or comparable cohort
- **THEN** it MUST receive no numeric `benchmark_fitness` row
- **AND** it MUST NOT receive a fabricated zero or singleton `0.5`

### Requirement: Strict search evidence may score only after exact validation

The system MUST allow the existing free-only Structured Output search processor
to contribute benchmark evidence only after exact model identity, returned URL,
and literal evidence quote validation succeed.

#### Scenario: Search result passes validation

- **WHEN** the fixed free model returns a benchmark row whose exact model, URL,
  and quote pass every existing strict-SO check
- **THEN** the system MUST retain that row with its search-derived provenance
  and may include a supported family/metric in scoring
- **AND** it MUST use no paid or alternate provider

#### Scenario: Search row is invalid or incomplete

- **WHEN** the model, benchmark, metric, value, URL, or quoted result text fails
  validation or is absent
- **THEN** the row MUST remain non-scoring candidate evidence

### Requirement: Independent benchmark fitness sources

The system MUST persist global automatic scores as `benchmark_fitness`, band
scores as `benchmark_fitness:<profile>`, and MUST preserve higher-priority
manual and Arena values.

#### Scenario: Score resolution with existing sources

- **WHEN** multiple applicable intelligence sources exist for one exact model
  and task
- **THEN** `user_override` MUST win over `arena_elo`, which MUST win over
  benchmark fitness
- **AND** matching profile fitness MUST win over global `benchmark_fitness`
  for a band request
- **AND** benchmark fitness MUST win over capability/static fallback sources
- **AND** score updates MUST NOT replace or delete `user_override` or
  `arena_elo`
- **AND** missing profile rows MUST fall through to global benchmark or
  existing capability/static scores without writing zero
- **AND** recomputation MUST remove obsolete profile rows when evidence no
  longer produces a score

#### Scenario: Fitness cache after score refresh

- **WHEN** derived benchmark fitness rows change
- **THEN** the in-process fitness cache MUST be invalidated before subsequent
  band selection
