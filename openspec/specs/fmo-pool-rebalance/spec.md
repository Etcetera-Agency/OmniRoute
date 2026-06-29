# fmo-pool-rebalance Specification

## Purpose

Define the FMO pool rebalance contract, planning inputs, solve behavior, tail
guardrails, and apply semantics used by the Hermes-managed OmniRoute fork.

## Requirements

### Requirement: Pool spec ingestion

The system SHALL accept a versioned `fmo-pools/v1` generation on a dedicated seam
(`PUT/POST /api/fmo/pools`) behind the `OMNIROUTE_FMO_POOLS_ENABLED` feature flag,
require management authentication for pool writes and usage reads, validate pool
writes against a Zod schema, and store accepted pools. When the flag is off the seam
SHALL be inert and OmniRoute behavior SHALL equal upstream. The system SHALL reject
an unknown or breaking contract shape and SHALL reject a pool that omits a per-pool
context lower bound; it SHALL NOT invent a default context lower bound. The system
SHALL fail the whole generation when any referenced `combo_id` does not exist; it
SHALL NOT create, delete, or synthesize combos. Storing a generation SHALL NOT
materialize or modify any combo.

#### Scenario: Flag off is a no-op

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is false
- WHEN a client calls `PUT /api/fmo/pools`
- THEN the seam returns a disabled response
- AND no combo row is read or written

#### Scenario: Unauthenticated pool write is rejected

- GIVEN the feature flag is on
- WHEN a client without management authentication calls `PUT /api/fmo/pools`
- THEN the request is rejected before validation or storage
- AND no generation marker or pool row is stored

#### Scenario: Valid generation accepted and stored

- GIVEN the flag is on and a well-formed `fmo-pools/v1` payload whose combos all exist
- WHEN the payload is submitted
- THEN every pool is stored with status accepted
- AND the generation marker is recorded
- AND no combo is materialized

#### Scenario: Missing referenced combo fails the generation

- GIVEN a pool referencing a `combo_id` that does not exist in OmniRoute
- WHEN the generation is validated
- THEN the whole generation is rejected
- AND no combo is created and no partial state is stored

#### Scenario: Missing context lower bound rejected

- GIVEN a pool whose constraints omit `min_context_tokens`
- WHEN the generation is validated
- THEN the generation is rejected
- AND no default context lower bound is substituted

#### Scenario: Unknown contract shape rejected

- GIVEN a payload with an unknown or breaking field shape
- WHEN it is validated
- THEN it is rejected without storing any pool

### Requirement: Head inventory snapshot

The system SHALL build the head inventory from active provider connections and the
synced model catalog, enriched with capabilities, context window, free status,
model-intelligence score, and quota/cooldown state. It SHALL expand a provider with
multiple active accounts into account-level candidates. It SHALL NOT enter
tail/fallback providers into the head inventory snapshot.

#### Scenario: Multi-account expansion

- GIVEN a provider with two active connections
- WHEN the inventory is built
- THEN the provider appears as two account-level candidates, one per `connectionId`

#### Scenario: Tail provider excluded from head

- GIVEN a provider listed only in the approved tail config
- WHEN the head inventory is built
- THEN that provider is not present as a head candidate

### Requirement: Model intelligence band resolution

The system SHALL resolve a candidate's quality against `model_intelligence.score`
for the pool's declared `category`, using the fixed source precedence
`user_override > arena_elo > models_dev_tier`. A candidate with no resolvable score
for the category SHALL NOT be a head candidate on score grounds. The band metric
SHALL be the normalized score in `[0..1]`; the system SHALL NOT use an Artificial
Analysis `intelligence_index`.

#### Scenario: In-band candidate passes

- GIVEN a pool band `{category: coding, min: 0.55, max: 0.80}` and a candidate whose resolved coding score is 0.7
- WHEN the band is checked
- THEN the candidate is in band

#### Scenario: Unrated candidate is not a score-based head candidate

- GIVEN a candidate with no `model_intelligence` row for the pool category
- WHEN the band is checked
- THEN the candidate is excluded from the head on score grounds

### Requirement: Quota source precedence and request-equivalent capacity

The system SHALL normalize provider-specific live usage, quota-cache, reset-window,
and per-model bucket shapes into candidate capacity axes before applying quota source
precedence: live quota, then static catalog figure, then search-research claim, then
observability calibration. It SHALL run search-research only when no live or static
number exists, and SHALL trust and count a search-research claim as-is toward
coverage with the tail insuring the error. Search-research SHALL call OmniRoute's
internal search chain directly and SHALL NOT call `POST /api/v1/search`, `fetch`
back into OmniRoute, or depend on the app route boundary. It SHALL first attempt
`gemini-grounded-search` and, only on a 429 from that attempt, SHALL fall back to the
chain's auto-routing order (provider unset -> configured search-provider priority),
not to a single fixed provider. It SHALL preserve the FMO quota query text, but SHALL
NOT introduce a separate FMO/Instructor inspector; it SHALL consume OmniRoute's
normalized `SearchResponse.answer.text` and `SearchResponse.results` directly. The
existing FMO `quota-research` prompt/rules SHALL remain the canonical extraction
contract: use supplied text only, never guess, require evidence, prefer cumulative
daily/monthly axes over RPM/TPM when present, choose range values by
`previousLimit`, and reject unusable claims. OmniRoute SHALL execute that contract
through its own internal LLM/chat pipeline with structured JSON output, using the
normalized search snapshot as input and validating the returned
`QuotaClaimResponse`. It SHALL NOT call the FMO Python client, the FMO Instructor
runtime, or an OmniRoute HTTP route for this extraction. The tier-3 quota result
SHALL retain a search snapshot with the query, provider used, answer text, result
snippets, evidence URLs, retrieval time, and content hash so the planning/debug
surface can explain the source. The system SHALL own the
request-equivalents conversion algebra and keep `tokens_per_request` a single global
learned factor; it SHALL compute candidate capacity as
`tokens_per_request = max(workload_class weight, global factor)` and fall back to the
global factor when `workload_class` is omitted.

#### Scenario: Static figure used without search

- GIVEN a candidate with no live quota but a static `monthlyTokens` figure
- WHEN quota is resolved
- THEN the static figure is used
- AND search-research is not run

#### Scenario: Search-research uses internal chain only

- GIVEN a candidate with no live quota and no static catalog figure
- WHEN search-research is run
- THEN OmniRoute calls the shared internal search chain directly
- AND it does not issue an HTTP request to `POST /api/v1/search`
- AND it does not construct a route `Request` or `Response`

#### Scenario: Search results become quota evidence

- GIVEN internal search returns `answer.text` and result URLs
- WHEN the tier-3 quota claim is extracted
- THEN `answer.text` is used as the primary quota text
- AND result snippets are used as fallback quota text
- AND result URLs are retained as evidence in the search snapshot
- AND the tier-3 quota result keeps the snapshot for planning/debug output

#### Scenario: Internal LLM extracts the claim

- GIVEN internal search has returned normalized answer/results
- WHEN OmniRoute extracts the tier-3 quota claim
- THEN it calls OmniRoute's own internal LLM/chat pipeline with structured JSON output
- AND it applies the FMO `quota-research` prompt/rules as the extraction contract over the normalized search output
- AND it passes `provider`, `provider_model_id`, `source_type`, `source_url`, `text`, and `previous_limit`
- AND it validates the returned `QuotaClaimResponse` before counting it
- AND it does not call a separate FMO/Instructor quota inspector

#### Scenario: Grounded search falls back to auto-routing only on quota

- GIVEN the `gemini-grounded-search` attempt returns 429
- WHEN search-research retries
- THEN the retry runs the chain with the provider unset, using the configured search-provider auto-routing order
- AND it does not pin a single fixed fallback provider
- AND no other provider error triggers that fallback

#### Scenario: Live quota adapter maps provider-specific shape

- GIVEN a provider usage response with per-model quota buckets and a matching model id
- WHEN quota is resolved for that candidate
- THEN the matching bucket is normalized into capacity axes before static catalog lookup
- AND the raw provider response shape is not read directly by the capacity comparator

#### Scenario: Class weight cannot understate the global factor

- GIVEN a pool with `workload_class = light` whose class weight is below the global factor
- WHEN capacity is computed
- THEN `tokens_per_request` equals the global factor, not the smaller class weight
