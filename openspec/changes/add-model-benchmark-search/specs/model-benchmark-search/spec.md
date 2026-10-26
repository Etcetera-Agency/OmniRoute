## ADDED Requirements

### Requirement: Queue new models.dev model identities durably

After an initial capability snapshot exists, each successful non-dry-run
models.dev sync with capability sync enabled SHALL queue each newly observed
exact model ID before replacing the previous capability snapshot. Repeated
syncs SHALL NOT create duplicate queue records. The first sync establishes the
baseline and SHALL NOT queue the entire catalog.

#### Scenario: First models.dev sync establishes a baseline

- **GIVEN** no prior `model_capabilities` rows exist
- **WHEN** models.dev capability sync succeeds
- **THEN** the capability snapshot is saved
- **AND** no benchmark search records are queued

#### Scenario: A new model ID triggers one durable search

- **GIVEN** a prior capability snapshot contains `model-a`
- **AND** the next successful sync contains `model-a` and `model-b`
- **WHEN** that sync saves capabilities
- **THEN** `model-b` is durably queued before the prior snapshot is replaced
- **AND** one queued search starts in the background
- **AND** repeated syncs do not add another queue row for `model-b`

#### Scenario: Dry-run or capability-disabled sync does not enqueue

- **GIVEN** models.dev contains an ID absent from the last capability snapshot
- **WHEN** sync runs with `dryRun=true` or `syncCapabilities=false`
- **THEN** no benchmark search row is created

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

Search evidence SHALL retain source/version, exact matched model identity,
benchmark/version, declared reasoning effort/config, metric/value, source URL,
source date, verification status, capture time, and raw source data. Missing
values SHALL remain null. Raw evidence SHALL be stored separately from the
frozen production score map and SHALL NOT change it.

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

After `/v1/search` returns results for a complete exact miss, the system SHALL
process those results only with `xingchen-agi/xing4.0-29b-a4b:free` through its
verified OpenRouter Phala endpoint. Before each inference, it SHALL verify one
exact Phala endpoint, zero prompt/completion pricing, support for
`response_format` and `structured_outputs`, and an active local OpenRouter
connection whose synced catalog marks the exact model free. It SHALL pin that
connection and send `json_schema` with `strict: true`, `provider.only: ["phala"]`,
`provider.require_parameters: true`, and `provider.allow_fallbacks: false`.
It SHALL clear session affinity for the one-shot request so a prior session pin
cannot replace the verified connection. It SHALL NOT retry within one
dispatch, rotate accounts, select another model/provider, or enter
global/emergency fallback. Queue-level rate-limit recovery is defined by the
source-work requirement below.
Extracted records SHALL remain candidate-review-required and SHALL NOT update
production scores.

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

Each source request SHALL have a timeout and bounded retry behavior. AA
pagination, HF results, web results, queue attempts, and evidence retention
queries SHALL use explicit limits. Identical evidence SHALL be idempotent, and
source errors SHALL record status and a bounded error string.
Explicit `ollama-search` calls SHALL be spaced at least 15 seconds apart;
actual free-SO calls SHALL be spaced at least five seconds apart. On HTTP 429
from either provider, the queue SHALL persist `Retry-After` or
`X-RateLimit-Reset`; if no header is available, it SHALL defer for 15 minutes.
The exact `No credentials configured for search provider: ollama-search` error
SHALL also defer for 15 minutes because provider connections may be cooling
down. The queue SHALL pause all benchmark work until the retry time, then
retry the same model with explicit `ollama-search` and the same pinned free
SO connection. Waiting for a retry time SHALL NOT consume an attempt. Each
actual HTTP 429 request SHALL consume the existing bounded attempt budget; the
exact no-credentials error happens before an upstream request and SHALL NOT
consume an attempt.

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

The queue SHALL claim no more than one model row before it starts processing
that row. It SHALL persist the row's final status and source receipt before
claiming the next row, while retaining the maximum of 20 rows per drain and
sequential provider execution. Each strict-SO request SHALL have a five-minute
deadline that aborts the pinned request; a timeout SHALL preserve collected
search evidence as review-required and leave the model unrated. If a drain finds
no eligible row but finds a fresh `running` row, it SHALL schedule a retry at
the earliest row's 15-minute stale boundary, independently of the models.dev
sync cadence.
Before loading source snapshots, the drain SHALL terminalize exhausted pending,
error, and stale-running rows. Claimable-row listing and queue eligibility SHALL
use the same predicate, except that configured-AA-key recovery may reclaim a
row whose recorded error is the missing-AA-key condition.

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
