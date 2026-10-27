## ADDED Requirements

### Requirement: Refresh current benchmarks after normal models.dev sync

After existing pricing and capability writes succeed, a normal non-dry-run sync
with capability sync enabled SHALL start a background full-catalog refresh
using that sync's fresh models.dev identities. Refresh failures SHALL NOT alter
completed pricing or capability writes. Refresh calls SHALL serialize in
invocation order and retain each call's catalog payload.

#### Scenario: First successful sync refreshes the complete catalog

- **GIVEN** no prior `model_capabilities` rows exist
- **WHEN** normal models.dev capability sync succeeds
- **THEN** the pricing and capability snapshot is saved
- **AND** the full-catalog refresh receives all fresh raw identities
- **AND** no model is enqueued or queue drain started

#### Scenario: Repeated sync replaces current observations

- **GIVEN** a normal sync starts refreshes with fresh canonical catalogs
- **WHEN** the direct source refresh completes successfully
- **THEN** each source/model current set is replaced from the complete result
- **AND** the newest refresh runs after earlier invocations
- **AND** no benchmark-search queue row is enqueued or drained by sync

#### Scenario: Dry-run or capability-disabled sync skips refresh

- **GIVEN** models.dev returns a valid catalog
- **WHEN** sync runs with `dryRun=true` or `syncCapabilities=false`
- **THEN** pricing/capability writes follow their existing gates
- **AND** no full-catalog refresh starts
- **AND** no benchmark-search queue operation starts

### Requirement: Keep optional discovery queue separate from normal sync

The existing benchmark discovery queue SHALL remain a separate workflow. Normal
models.dev sync SHALL NOT enqueue identities or drain this queue. Valid manual
HF or queued source updates SHALL replace only their exact model/source current
set; errors and malformed responses SHALL preserve the last valid set.

#### Scenario: Normal sync does not modify discovery queue state

- **GIVEN** pending or completed benchmark-search queue rows exist
- **WHEN** normal models.dev sync succeeds or its benchmark refresh fails
- **THEN** queue claims, attempts, and statuses remain unchanged
- **AND** existing pricing and capability sync results are preserved

### Requirement: Require complete exact misses before discovery search

The source lookup SHALL compare exact model IDs or declared display names,
ignoring only surrounding whitespace and letter case. It SHALL require a
complete Artificial Analysis Free scan and complete SWE-bench,
Terminal-Bench 2.0, Terminal-Bench 2.1, and DeepSWE responses before it may
classify a model as missing from known leaderboards. An error or incomplete
scan SHALL remain a source error and SHALL NOT trigger discovery search.

#### Scenario: Known-source record suppresses discovery search

- **GIVEN** a source has a complete record for the exact model identity
- **WHEN** the AA and official leaderboard sources are checked
- **THEN** the matching evidence is persisted
- **AND** Hugging Face and web discovery are not called

#### Scenario: Complete miss searches HF and the configured free provider

- **GIVEN** AA Free and all four official leaderboard datasets completed
- **AND** none contains the exact model identity
- **WHEN** the lookup continues
- **THEN** Hugging Face model eval metadata is queried
- **AND** web discovery resolves configured credentials for `ollama-search`
- **AND** web discovery uses only `ollama-search` without an alternate
- **AND** the provider registry and returned usage both report zero cost
- **AND** returned records are stored as review-required evidence

#### Scenario: Paid or substituted search is rejected

- **GIVEN** the configured search provider is missing, has nonzero registry
  cost, returns another provider ID, or reports nonzero search cost
- **WHEN** web discovery runs
- **THEN** the result is rejected and no strict-SO model request is sent
- **AND** no alternate or paid search provider is tried
- **AND** the model remains unrated with a source error receipt

#### Scenario: Incomplete source scan prevents a false negative

- **GIVEN** any required source errors or reports incomplete pagination
- **WHEN** the source scan finishes
- **THEN** no complete-miss state is recorded
- **AND** HF and web discovery are not called
- **AND** the model remains unrated with its source error receipt

#### Scenario: Exact known-source match without a usable fitness score

- **GIVEN** AA or any official source has an exact model match
- **AND** the direct evidence does not produce coding or general fitness
- **WHEN** the complete source scan finishes
- **THEN** the run is marked review-required
- **AND** HF and Ollama Web Search are not requested

### Requirement: Preserve evidence without publishing benchmark scores

Current benchmark evidence SHALL retain only formula inputs and source
references required by existing readers: source/version, exact matched model
identity, benchmark/version, declared reasoning effort/config, metric/value,
source URL/date, verification status, and capture time. Missing values SHALL
remain null. Raw JSON payloads and changed-value history SHALL NOT be stored.
Unverified search results SHALL remain review-only and SHALL NOT change native
fitness.

#### Scenario: Missing effort or score stays unknown

- **GIVEN** a source record omits effort, config, or metric value
- **WHEN** evidence is persisted
- **THEN** each absent field remains null
- **AND** no value is synthesized as zero

#### Scenario: Search material stays unrated until strict processing is proven

- **GIVEN** an exact-missing model has HF or free-web search results
- **WHEN** strict free-only routing and native server-enforced SO are not
  proven
- **THEN** evidence remains review-required and the model remains unrated
- **AND** no model inference or score-map write occurs

### Requirement: Process free-web results through verified strict Structured Output

After a complete exact miss, the system SHALL process search results only with
`xingchen-agi/xing4.0-29b-a4b:free` through a verified, zero-cost Phala endpoint
and an active local free connection. Pin that connection and use strict
Structured Output. The one-shot request SHALL not retry, rotate accounts, or
select another model/provider or fallback. Extracted records remain
candidate-review-required and do not update production scores.

#### Scenario: Missing free endpoint or connection blocks inference

- **GIVEN** search results exist
- **AND** endpoint metadata, exact zero pricing, strict-schema support, or an
  exact free local connection is missing
- **WHEN** the processor evaluates the request
- **THEN** it records a blocked unrated state
- **AND** it sends no model request

#### Scenario: Existing session affinity cannot replace the free connection

- **GIVEN** an existing session affinity points to another OpenRouter connection
- **AND** the exact free Phala gates select a different eligible connection
- **WHEN** the one-shot normalization request is dispatched
- **THEN** the prior session affinity is ignored
- **AND** the request uses the selected free connection or stops without fallback

#### Scenario: Valid strict output becomes review-required evidence only

- **GIVEN** every endpoint and exact-free-connection gate passes
- **WHEN** the pinned Phala model returns a strict-schema response
- **AND** the model identity, URL, and literal quote match returned search data
- **THEN** the extracted fields are stored as candidate-review-required
- **AND** no rating or score-map write occurs

#### Scenario: Invalid strict output does not trigger retry or fallback

- **GIVEN** one pinned model request returns malformed, non-stop, or mismatched
  output
- **WHEN** validation fails
- **THEN** the search remains unrated with a bounded error receipt
- **AND** no retry, alternate model, provider, account, or fallback request occurs

### Requirement: Bound and deduplicate source work

Bound source requests, pagination, result counts, queue attempts, and persisted
errors. Identical current observations SHALL be idempotent. Queue retries SHALL
honor per-provider spacing and cooldowns, preserve the pinned free connection,
and consume attempts only when the request reaches an upstream provider.

#### Scenario: Rate-limited Ollama search is durably deferred

- **GIVEN** explicit `ollama-search` returns HTTP 429
- **AND** it provides `Retry-After` or `X-RateLimit-Reset`
- **WHEN** the queue stores the failed result
- **THEN** it persists the parsed retry instant and raw search failure
- **AND** it does not call strict-SO for that row
- **AND** it pauses all benchmark work until that instant
- **AND** it retries the same model through explicit `ollama-search`
- **AND** the HTTP 429 request counts toward the existing maximum attempts
- **AND** no paid or alternate route is attempted

#### Scenario: Rate-limited normalization is durably deferred

- **GIVEN** the pinned exact-free request returns HTTP 429
- **AND** it provides `Retry-After` or `X-RateLimit-Reset`
- **WHEN** the queue stores the failed result
- **THEN** it persists the parsed retry instant and preserves collected search evidence
- **AND** it pauses all benchmark work until that instant
- **AND** it retries the same model through the same pinned free connection
- **AND** the HTTP 429 request counts toward the existing maximum attempts
- **AND** no paid or alternate route is attempted

#### Scenario: Strict-SO retry keeps its originally pinned connection

- **GIVEN** a pinned exact-free connection returns HTTP 429
- **AND** another eligible free connection appears before the cooldown expires
- **WHEN** the same model is retried
- **THEN** the queue uses the original connection if it remains eligible
- **AND** it blocks normalization without dispatch if the original connection is no longer eligible
- **AND** it never switches the retry to the newly available connection

#### Scenario: Cooling search connections report no credentials

- **GIVEN** explicit `ollama-search` fails with
  `No credentials configured for search provider: ollama-search`
- **WHEN** the queue stores the failed result
- **THEN** it defers the same model for 15 minutes without calling strict-SO
- **AND** it pauses all benchmark work until the retry instant
- **AND** it does not consume an attempt because no upstream request occurred

#### Scenario: Repeated 429 responses stop at the existing retry maximum

- **GIVEN** the same model has reached `MAX_SEARCH_ATTEMPTS` through real
  provider requests that returned HTTP 429
- **WHEN** another queue drain runs after the cooldown
- **THEN** no additional search or strict-SO request is made for that model
- **AND** any collected candidate evidence remains review-required and unrated

#### Scenario: Rate-limit response without reset headers uses bounded fallback delay

- **GIVEN** explicit search or pinned strict-SO returns HTTP 429 without reset headers
- **WHEN** the queue stores the failed result
- **THEN** it persists a retry instant 15 minutes later
- **AND** it keeps the same global pause, provider, model, and exact-free routing guarantees

#### Scenario: Repeated source result does not duplicate evidence

- **GIVEN** the same source record is returned on a retry
- **WHEN** evidence is persisted
- **THEN** one row with the same deterministic evidence hash is retained

#### Scenario: Retry exhaustion stays unrated

- **GIVEN** a model search has reached its maximum attempts
- **WHEN** another queue drain runs
- **THEN** the model is marked `retry_exhausted_unrated`
- **AND** no score is assigned

### Requirement: Keep benchmark search drains live and recover stale claims

The optional queue SHALL claim and finish one model at a time, persist each
outcome before claiming another, and process at most 20 rows per drain. It SHALL
recover fresh `running` rows at the existing 15-minute stale boundary and
terminalize exhausted rows before loading source snapshots. Strict-SO requests
remain bounded and pinned to the selected free connection.

#### Scenario: Slow row does not preclaim the rest of the batch

- **GIVEN** two eligible models are queued
- **AND** the first model's strict-SO request does not return before its
  deadline
- **WHEN** the drain runs
- **THEN** only the first model is `running` while it is being processed
- **AND** its collected HF and web-search evidence is persisted before the
  strict-SO request
- **AND** when its request times out, the row finishes with a bounded error
  receipt and remains unrated
- **AND** the second model is then claimed and processed in the same drain

#### Scenario: Restarted fresh running row gets a stale-boundary retry

- **GIVEN** a model row is `running` with a `last_run_at` younger than 15
  minutes
- **WHEN** a new drain starts and no other row is eligible
- **THEN** no new provider request is sent
- **AND** one retry is scheduled for the remaining stale interval
- **WHEN** that row reaches the stale boundary
- **THEN** a later drain may claim it under the normal attempt limit

#### Scenario: Exhausted rows do not trigger a source refresh

- **GIVEN** a pending row has reached the maximum attempt count
- **WHEN** the drain begins
- **THEN** the row is marked `retry_exhausted_unrated`
- **AND** the row is excluded from claimable-work checks
- **AND** no source snapshot is loaded unless another eligible row exists

### Requirement: Keep distinct benchmark metrics as distinct evidence

The evidence fingerprint SHALL include benchmark and metric identity so
distinct observations from one source row remain separate and repeat inputs
remain idempotent. Full refresh SHALL recreate observations from current source
rows and replace the current set without adding history. Migration SHALL use the
existing formula-observation key and SHALL NOT replay stored raw payloads.

#### Scenario: One AA payload row persists both published metrics

- **GIVEN** an AA Free row includes both
  `artificial_analysis_coding_index` and
  `artificial_analysis_intelligence_index`
- **WHEN** its current `AA Coding` and `AA Intelligence` observations are
  materialized
- **THEN** one row is retained for each benchmark and metric
- **AND** each row retains its own formula value and required source reference
- **AND** raw payload data is not persisted
- **AND** a repeated refresh replaces each metric independently
- **AND** fitness recomputation sees both metric observations

#### Scenario: Refresh repairs prior cross-metric collision idempotently

- **GIVEN** a legacy direct-source set lacks one of the two metrics
- **AND** the current complete AA source row contains both metrics
- **WHEN** a full-catalog refresh replaces that current source set
- **THEN** both benchmark/metric observations persist
- **AND** repeated refresh leaves exactly one current observation per metric

### Requirement: Gate discovery search on active synced model identity

After a complete direct-source miss, query HF or Ollama Search only when the
queued ID exactly matches an active synced provider ID after case folding. A
missing ID SHALL remain unrated with reason
`model_not_in_active_synced_catalog` and SHALL trigger no HF, search, or strict-SO
request. This check SHALL NOT change client-request or provider-attempt counts.

#### Scenario: Unavailable model cannot start discovery requests

- **GIVEN** AA and every official source completed with an exact miss
- **AND** no active synced provider catalog contains the exact model ID after
  case folding
- **WHEN** the queue evaluates discovery eligibility
- **THEN** it persists reason `model_not_in_active_synced_catalog`
- **AND** it finishes the model `unrated_no_evidence`
- **AND** it sends no HF, Ollama Search, or strict-SO request

#### Scenario: Case-folded exact model ID preserves HF discovery

- **GIVEN** AA and every official source completed with an exact miss
- **AND** an active synced provider catalog contains the same model ID with
  different letter case
- **WHEN** the queue evaluates discovery eligibility
- **THEN** it continues through the existing HF query and model-detail route
- **AND** it preserves explicit zero-cost Ollama Search with no alternate
- **AND** it makes no name, prefix, alias, or substring match

### Requirement: Load full canonical current benchmark snapshots

The normal models.dev hook and explicit operator SHALL share a refresh over
every canonical raw model ID. Normal sync passes its fresh IDs after existing
pricing/capability writes; the operator reads the complete persisted catalog.
Validate all five sources before writes. Match exact IDs first, then unique
exact names; leave ambiguous matches unmatched. Preserve existing formula and
consumer behavior.

#### Scenario: Full canonical catalog includes inactive identities

- **GIVEN** `model_capabilities` contains a canonical ID absent from active
  provider catalogs and from the search queue
- **AND** all five direct sources return complete nonempty snapshots
- **WHEN** the operator performs a current refresh
- **THEN** the inactive canonical ID is considered for exact evidence matching
- **AND** all canonical IDs are included in base and profile recomputation
- **AND** no search queue row, search request, or inference request is created

#### Scenario: Exact ID takes precedence over unique-name matching

- **GIVEN** one source observation matches a raw canonical ID and its declared
  name matches a different canonical model
- **AND** another source observation has no canonical ID and matches one exact
  canonical name
- **AND** a third source name is duplicated across canonical IDs
- **WHEN** the refresh materializes current evidence
- **THEN** the exact ID row uses its exact canonical raw ID
- **AND** the unmatched ID row uses the unique exact-name canonical raw ID
- **AND** the duplicated name is unmatched as ambiguous
- **AND** no provider prefix is added to the fitness key

#### Scenario: A successful refresh replaces changed and deleted observations

- **GIVEN** a model/source set has multiple current effort and harness rows
- **AND** the next complete source snapshot changes one value and omits an old row
- **WHEN** the refresh publishes the new snapshot
- **THEN** the changed value replaces the old value
- **AND** the omitted row is deleted
- **AND** every distinct current effort/harness row is retained
- **AND** repeating the same snapshot does not increase evidence row count

#### Scenario: Incomplete sources preserve evidence and scores

- **GIVEN** current evidence and native scores exist
- **AND** one source is empty, invalid, incomplete, or errors
- **WHEN** the full-catalog refresh runs
- **THEN** it returns an incomplete receipt and makes no evidence writes
- **AND** it makes no base or profile score writes
- **AND** current evidence and native scores remain unchanged

### Requirement: Publish native fitness atomically

A complete refresh SHALL replace all five direct source sets and the four owned
native fitness sources in one transaction. Clear all benchmark evidence and
owned fitness for removed catalog IDs; preserve current non-direct sets for
IDs still present. Use raw canonical IDs and preserve overrides, arena, and
unrelated sources. Keep formulas, filters, routing, capabilities, and defaults
unchanged.

#### Scenario: Native publication reaches the unchanged actual band consumer

- **GIVEN** canonical raw ID `z-ai/glm-5.3` has a higher current score than a
  free, tool-capable peer
- **WHEN** the full refresh publishes fitness and the existing consumers build
  `coding_high_tools:free` and `general_high_tools:free`
- **THEN** both consumers look up `benchmark_fitness:high` using raw ID
  `z-ai/glm-5.3`
- **AND** route-facing `candidate.modelStr` remains `nvidia/z-ai/glm-5.3`
- **AND** formula, profile precedence, and band ranges are unchanged

#### Scenario: Removed canonical identity loses all benchmark-owned current state

- **GIVEN** a removed model has direct, HF, and other benchmark evidence plus
  owned base/profile fitness rows
- **AND** a still-canonical model has a valid current HF set
- **WHEN** a complete full-catalog refresh excludes the removed model
- **THEN** every benchmark evidence scope and owned fitness key for the removed
  model is deleted
- **AND** the current HF set for the still-canonical model remains unchanged
- **AND** `user_override`, arena, and unrelated native sources remain unchanged

#### Scenario: Refresh calls preserve invocation order

- **GIVEN** two refresh calls arrive with different complete catalogs
- **WHEN** the first call is rejected or commits before the second
- **THEN** the second call uses its own catalog payload and runs after the first
- **AND** the failed first call does not poison the second

### Requirement: Compact legacy evidence without payload history

Migration 200 SHALL rename `model_benchmark_search_evidence`, compact by the
exact existing formula-observation key, keep the latest `captured_at` row using
the reader's tie order, and drop `raw_json` for every source. Preserve distinct
keys. Do not infer missing source batches or empty outcomes, and do not publish
scores during migration.

#### Scenario: Legacy rename waits for a complete current refresh

- **GIVEN** the old evidence table contains rows from multiple source captures
- **WHEN** migration 200 runs or a source feed later fails validation
- **THEN** migration renames the table and preserves existing rows
- **AND** no score recomputation occurs
- **WHEN** the first valid complete full-catalog refresh commits
- **THEN** it replaces direct-source rows, compacts only duplicate exact
  formula-observation keys to their latest capture, and clears every legacy
  raw payload
- **AND** evidence and base/profile scores commit atomically

### Requirement: Replace optional source sets safely

The separate HF and queue paths SHALL replace only validated exact
model/source sets, including valid-empty sets, and recompute fitness atomically.
Failures and malformed responses preserve the last valid set. Unverified
search candidates remain review-only and outside formula inputs.

#### Scenario: Valid empty non-direct update clears and republishes

- **GIVEN** a model/source set has current HF or validated queue observations
- **WHEN** a later successful source response contains no observations
- **THEN** that exact source/model set is cleared
- **AND** native fitness is recomputed in the same transaction
- **WHEN** the response is malformed or fails
- **THEN** the last valid set and published fitness remain unchanged

#### Scenario: Successful HF updates replace the current source/model set

- **GIVEN** a model has multiple current HF benchmark observations
- **WHEN** a later successful HF response changes or removes those observations
- **THEN** its HF source set is replaced, including a valid empty set
- **AND** older changed-value rows are absent
- **WHEN** the HF response errors or is invalid
- **THEN** the last valid HF source set remains unchanged

### Requirement: Verify direct operator runtime dependencies in the final image

The backend overlay SHALL load the copied operator's complete runtime module
graph in the final image dependency tree. An unresolved import SHALL fail
packaging. The check SHALL stop before catalog/source reads, database writes,
queue work, search, or inference; it SHALL not change startup or the entrypoint.

#### Scenario: An unresolved package blocks the image build

- **GIVEN** the bundled operator imports a runtime package absent from the
  final image dependency tree
- **WHEN** the operator runtime packaging check runs after the bundle is copied
- **THEN** the check fails with the unresolved module
- **AND** the image is not accepted as package-complete
- **AND** it performs no database, queue, source, search, or inference work

#### Scenario: Resolved operator imports pass without operational side effects

- **GIVEN** every runtime import used by the bundled operator resolves in the
  final image dependency tree
- **WHEN** image packaging runs the operator runtime check
- **THEN** the check loads the bundle and exits before active-catalog reads or
  source requests
- **AND** it performs no database writes, queue work, search, or inference
- **AND** normal service startup and its entrypoint remain unchanged
