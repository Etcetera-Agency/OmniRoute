## ADDED Requirements

### Requirement: Extract explicit models.dev zero-price identities

A successful models.dev extraction SHALL record a raw provider/model pair only
when input and output prices are explicitly numeric zero and every other
published price is also numeric zero. It SHALL preserve raw provider and full
model IDs, omit dynamic `openrouter/free`, and SHALL NOT infer zero from
missing or normalized prices.

#### Scenario: Exact zero-price record

- **GIVEN** a raw provider/model has explicit numeric input and output prices
  of 0, with no other published nonzero price
- **WHEN** the models.dev evidence snapshot is extracted
- **THEN** it contains that exact raw provider/model pair

#### Scenario: Partial or dynamic pricing record

- **GIVEN** output price is missing, a published price is nonzero, or the model
  is the dynamic `openrouter/free` alias
- **WHEN** the evidence snapshot is extracted
- **THEN** the model is absent

### Requirement: Apply exact price evidence without bypassing static checks

With `freeAccessPolicy: strict`, the filter SHALL apply existing exact static
budget rules unchanged. Only a candidate with no exact static entry MAY pass
through fresh exact models.dev evidence. This path SHALL preserve the existing
connection allowlist and SHALL NOT create quota, free-regime, or hard-stop
metadata.

#### Scenario: Fresh exact candidate in the free pool

- **GIVEN** the candidate is already in the upstream free pool, has no exact
  static entry, and the fresh evidence has the exact provider and full model ID
- **WHEN** strict policy evaluates the candidate
- **THEN** it remains eligible on its existing connection

#### Scenario: Static quota remains authoritative

- **GIVEN** an exact static entry is quota-exhausted and models.dev also lists
  that model at zero price
- **WHEN** strict policy evaluates the candidate
- **THEN** the existing static quota rule excludes it

### Requirement: Expire and fail closed on unusable evidence

The raw evidence snapshot SHALL be replaced atomically with normalized pricing
only after a successful, non-dry-run sync, using the underlying source-fetch
time. It MAY authorize candidates for at most 36 hours. Missing, malformed,
disabled, future-dated, or stale evidence SHALL fail closed.

#### Scenario: Dry-run or failed sync

- **GIVEN** a previous snapshot exists and a later sync is dry-run or fails
- **WHEN** the sync finishes
- **THEN** the previous snapshot remains unchanged

#### Scenario: Stale or disabled evidence

- **GIVEN** evidence is older than 36 hours or models.dev sync is disabled
- **WHEN** strict policy evaluates a candidate
- **THEN** the evidence does not admit it

#### Scenario: Strict policy disabled

- **GIVEN** `freeAccessPolicy` is not `strict`
- **WHEN** the candidate pool is built
- **THEN** the existing identity pass-through remains unchanged
