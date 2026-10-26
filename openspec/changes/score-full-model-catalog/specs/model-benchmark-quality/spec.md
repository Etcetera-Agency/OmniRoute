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

### Requirement: Evidence-based model-level scores

The system MUST calculate `coding` and `general` fitness only from supported,
exactly matched, numeric evidence and MUST leave a model unrated when neither
task can be supported.

#### Scenario: Observations span multiple efforts and versions

- **WHEN** exact observations exist for more than one reasoning effort,
  benchmark version, or configuration
- **THEN** the system MUST normalize them within their comparable cohort and
  combine available observations by median
- **AND** a missing effort/configuration MUST contribute no value and MUST NOT
  become zero

#### Scenario: Benchmark-family aggregation

- **WHEN** eligible observations include multiple benchmark versions or
  reasoning efforts in the same family
- **THEN** the system MUST count at most one median vote per family
- **AND** benchmark-only coding fitness MUST require at least two independent
  benchmark families unless AA Coding is available

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

### Requirement: Independent benchmark fitness source

The system MUST persist automatic scores as `benchmark_fitness` and MUST
preserve higher-priority manual and Arena values.

#### Scenario: Score resolution with existing sources

- **WHEN** multiple applicable intelligence sources exist for one exact model
  and task
- **THEN** `user_override` MUST win over `arena_elo`, which MUST win over
  `benchmark_fitness`
- **AND** `benchmark_fitness` MUST win over capability/static fallback sources
- **AND** score updates MUST NOT replace or delete `user_override` or
  `arena_elo`

#### Scenario: Fitness cache after score refresh

- **WHEN** derived benchmark fitness rows change
- **THEN** the in-process fitness cache MUST be invalidated before subsequent
  band selection
