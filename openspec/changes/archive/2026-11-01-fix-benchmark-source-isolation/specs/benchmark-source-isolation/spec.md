# Benchmark source isolation Specification

## ADDED Requirements

### Requirement: Discovery continues after unusable direct source checks

WHEN direct source checks contain errors or incomplete results and no usable
positive evidence exists, THE system SHALL continue discovery after verifying
the exact active catalog model ID. THE system SHALL try Hugging Face first and
SHALL use the existing web search only when Hugging Face provides no usable
evidence. THE system SHALL preserve each source's actual status and existing
positive-evidence early returns.

#### Scenario: Direct error and incomplete checks reach Hugging Face

GIVEN the model has an exact active catalog ID and no usable positive direct
evidence
AND direct checks contain an error and an incomplete result
WHEN discovery runs
THEN Hugging Face search runs
AND the direct error and incomplete statuses remain visible in the receipt.

#### Scenario: Usable Hugging Face evidence suppresses web search

GIVEN direct checks have no usable positive evidence
AND Hugging Face returns usable evidence
WHEN discovery runs
THEN that evidence is processed
AND Ollama Search does not run.

#### Scenario: Unusable or failed Hugging Face evidence allows web search

GIVEN direct checks have no usable positive evidence
AND Hugging Face returns no usable evidence or an error
WHEN discovery runs
THEN the existing Ollama Search path runs
AND Hugging Face error status remains visible when applicable.

#### Scenario: Failed direct dataset remains stored

GIVEN a direct source has previously stored evidence
AND its refresh is failed or incomplete
WHEN discovery and persistence finish
THEN the prior direct-source rows remain unchanged.

### Requirement: Snapshot refresh replaces successful source datasets

WHEN benchmark source datasets have refresh results, THE system SHALL replace
only datasets that completed with nonempty rows. THE system SHALL retain old
rows for failed, incomplete, or source-level empty datasets. For a successful
source, a catalog model with no match SHALL have its model/source set replaced
with no rows.

#### Scenario: Mixed source results replace only completed nonempty sources

GIVEN one source completes with rows
AND other sources fail, remain incomplete, or complete empty
WHEN the snapshot refresh publishes
THEN only the completed nonempty source pairs enter the replacement batch
AND old evidence for all other source pairs remains.

#### Scenario: Successful source has no model match

GIVEN a source completes with a nonempty dataset
AND the current catalog model has no matching row in that dataset
WHEN that source is replaced
THEN the model/source pair is replaced with an empty set
AND stale rows for that pair are removed.

#### Scenario: Partial refresh defers global obsolete-ID cleanup

GIVEN at least one configured source failed, is incomplete, or is empty
WHEN another source refreshes successfully
THEN rows for model IDs outside the current catalog are not globally deleted.

#### Scenario: No successful source is a no-op

GIVEN all source datasets failed, are incomplete, or are empty
WHEN snapshot refresh finishes
THEN evidence and fitness are not mutated
AND the receipt reports zero writes and each actual source status.

#### Scenario: Full successful refresh keeps obsolete cleanup

GIVEN every configured source completes with nonempty rows
WHEN the snapshot refresh publishes
THEN current source sets are replaced
AND obsolete model/source evidence is cleaned up as before.

### Requirement: Snapshot publication is atomic

WHEN at least one source dataset is replaced, THE system SHALL publish fitness
in the same transaction. THE system SHALL defer global obsolete-ID cleanup
while any configured source is not publishable, and SHALL invalidate fitness
cache only after commit. If no source dataset is publishable, THE system SHALL
leave evidence and fitness unchanged and report each actual source status.

#### Scenario: Fitness publication failure rolls back the refresh

GIVEN a successful source replacement is attempted
AND fitness publication throws
WHEN the transaction exits
THEN evidence and fitness writes are rolled back together
AND fitness cache is not invalidated.

#### Scenario: Fitness cache changes only after commit

GIVEN a successful partial or full source replacement
WHEN database publication commits
THEN fitness cache is invalidated after commit.

### Requirement: Normalization accepts valid rows independently

WHEN a valid normalization envelope contains benchmark rows, THE system SHALL
validate each row independently, accept rows that pass the existing source
validation, and report original indexes with stable rejection reason codes for
rows that fail. THE system SHALL keep only accepted row data and rejection
metadata, not raw model response text. If the envelope is invalid or no rows are
accepted, THE system SHALL preserve the previous normalized-source set.

#### Scenario: Mixed normalized rows keep valid rows and indexed rejections

GIVEN one response contains valid and invalid rows
WHEN normalization completes
THEN valid rows are accepted
AND each rejected row has its original index and reason code counts
AND raw model response text is not persisted.

#### Scenario: Invalid envelope preserves prior normalized evidence

GIVEN prior normalized-source evidence exists
AND response content is missing, finish_reason is not stop, or JSON is malformed
WHEN normalization completes
THEN no normalized-source replacement occurs
AND the invalid-envelope reason is recorded.

#### Scenario: All rows rejected preserves prior normalized evidence

GIVEN a valid envelope contains rows that all fail validation
WHEN normalization completes
THEN prior normalized-source evidence remains
AND indexed rejection reasons are reported.

#### Scenario: Empty accepted set preserves unmatched evidence

GIVEN a valid response has an empty results array
WHEN normalization completes
THEN prior normalized-source evidence remains because search input is not a
complete benchmark-source snapshot.

#### Scenario: Existing source validation remains strict

GIVEN a row has a wrong model, unknown URL, nonliteral quote, missing populated
field, or nonfinite number
WHEN that row is validated
THEN it is rejected with its row index and reason code.

### Requirement: Accepted normalized observations replace by fitness identity

WHEN accepted normalized rows are persisted, THE system SHALL replace prior
rows matching the existing fitness observation identity and SHALL retain
unmatched rows from that model/source. THE system SHALL not use evidenceHash as
observation identity. THE system SHALL recognize
ollama-search-structured-output through the existing benchmark-to-family
mapping without changing fitness formulas.

#### Scenario: Changed value replaces the matching observation

GIVEN a stored normalized observation and a newly accepted row share the
existing identity but have different values and evidence hashes
WHEN the new row is persisted
THEN only the new matching observation remains
AND it contributes to fitness.

#### Scenario: Unmatched prior observation remains

GIVEN a stored normalized observation has a different existing identity from
all accepted rows
WHEN the new rows are persisted
THEN the unmatched prior observation remains.

#### Scenario: Current normalized source reaches fitness

GIVEN an accepted row uses source
ollama-search-structured-output and a benchmark handled by the existing family
mapping
WHEN fitness observations are derived
THEN the row is eligible under that same family mapping
AND scoring formulas remain unchanged.
