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

### Requirement: One-generation global solve

The system SHALL process the published pool set as one batch allocation problem and
SHALL NOT rebalance pools independently inside one generation. It SHALL load the
previous applied generation as an incumbency prior, build one head inventory
snapshot, sort pools by specificity and scarcity descending, and reserve exact-fit
rare candidates for stricter pools before filling less specific pools. The solve
SHALL emit a per-combo materialization plan and SHALL NOT write combos itself.

#### Scenario: Rare candidate reserved for the strict pool

- GIVEN a tools pool and a text pool, and a single tool-capable candidate
- WHEN the global solve runs
- THEN the tool-capable candidate is reserved for the tools pool
- AND the text pool is filled from text-capable candidates first

#### Scenario: Solve is stateful

- GIVEN a previous applied generation exists
- WHEN a new generation is solved
- THEN the previous assignments are loaded as the incumbency prior
- AND the solve is not computed from an empty prior

### Requirement: Deterministic fill ladder

The system SHALL fill each pool by the deterministic ladder: exact-fit in-band, then
relax the AA band within `max_delta`, then in-band higher-capability overflow. It
SHALL relax the AA band before spending higher-capability overflow candidates, and
SHALL NOT relax capability, context, or free gates. Higher-capability overflow SHALL
be allowed only after the stricter pools that need those candidates are covered.

#### Scenario: Relax precedes overflow

- GIVEN a pool underfilled after exact-fit in-band
- WHEN the ladder continues
- THEN the band is relaxed within `max_delta` and refilled before any higher-capability overflow is spent

#### Scenario: Hard gate never relaxed

- GIVEN a pool still underfilled after all ladder steps
- WHEN filling stops
- THEN no candidate that fails capability, context, or free gates is added

### Requirement: Quota-learning canary

The system SHALL seat a no-number calibration candidate first in its combo and SHALL
NOT count its capacity toward demand coverage until its ceiling is observed. The
known capacity built by the ladder SHALL sit below the canary as the absorbing
fallback. The system SHALL NOT treat a quota-learning canary as an unrated-score
canary.

#### Scenario: Canary seated first, not counted

- GIVEN a candidate with no resolvable quota number
- WHEN the pool combo plan is built
- THEN the candidate is placed first in the combo
- AND its capacity is not counted toward the pool's demand coverage
- AND the ladder-built known capacity is placed below it

### Requirement: Generation stability

The system SHALL prefer incumbent candidates over challengers unless a challenger
beats the incumbency margin, and SHALL keep a provider/model pinned to its previous
`connectionId` while that account is alive and not exhausted, adding new accounts at
the margin rather than reshuffling placed pins. Stability SHALL apply only among
eligible candidates and SHALL NOT override capability, context, band, free, or quota
gates; a degraded incumbent SHALL be dropped immediately. The system SHALL NOT mix
account-pinned and account-unpinned entries for the same provider in one generation,
and SHALL record stability outcomes (kept, displaced, dropped) with reasons.

#### Scenario: Incumbent kept within margin

- GIVEN an incumbent member and a challenger that does not beat the incumbency margin
- WHEN the pool is solved
- THEN the incumbent keeps its seat
- AND the decision record marks it as kept

#### Scenario: Degraded incumbent dropped

- GIVEN an incumbent that fell out of band or exhausted its quota
- WHEN the pool is solved
- THEN the incumbent is dropped immediately with no margin
- AND the decision record carries the drop reason

#### Scenario: No mixed pinning per provider

- GIVEN a provider used across several combos in one generation
- WHEN the plan is built
- THEN that provider's entries are either all account-pinned or all account-unpinned

### Requirement: Config-driven tail

The system SHALL read an approved tail config on every combo rebuild, filter entries
by the pool's capabilities and context, and append matching entries after the head.
Tail entries SHALL always be account-unpinned and SHALL NOT carry a `connectionId`.
Tail/fallback providers SHALL be a class disjoint from head inventory providers. The
tail SHALL NOT be counted as forecast demand capacity and SHALL be treated as
above-quota overflow safety. The system SHALL drop and log any tail entry whose
provider is account-pinned in the same generation's head.

#### Scenario: Tail is account-unpinned and uncounted

- GIVEN a pool whose demand is already covered by head candidates
- WHEN the tail is appended
- THEN tail members carry no `connectionId`
- AND the tail does not change the pool's covered-demand calculation

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

### Requirement: Atomic generation apply

The system SHALL update existing combo members/config only after the whole
generation validates, and SHALL set FMO-owned combos to `priority` strategy during
apply. It SHALL apply a generation atomically: all combo rows, the generation
marker, and the decision log commit in one transaction or none do. On any apply
error it SHALL keep the previous generation fully live and untouched (fail-closed),
SHALL NOT expose a half-applied generation to runtime, and SHALL advance the
incumbency prior only on a committed generation.

#### Scenario: All-or-nothing apply

- GIVEN a generation that rewrites three combos
- WHEN the third combo write fails inside the transaction
- THEN none of the three combos are changed
- AND the previous generation stays fully live

#### Scenario: Priority strategy on apply

- GIVEN an accepted generation
- WHEN it is applied
- THEN each referenced combo is written with `strategy = priority`
- AND its members are the head followed by the tail

#### Scenario: Prior advances only on commit

- GIVEN an apply that aborts and rolls back
- WHEN the next generation solves
- THEN the incumbency prior is still the last committed generation

#### Scenario: Shadow apply writes nothing

- GIVEN a stored generation and shadow mode
- WHEN the rebalance runs in shadow
- THEN a plan/diff is produced
- AND no combo row is modified

### Requirement: Rebalance scheduling

The system SHALL run scheduled rebalance once or twice per day plus manual and
new-generation triggers, initialized from the existing startup background-job path,
self-gated by `OMNIROUTE_FMO_POOLS_ENABLED`, non-blocking, and never fatal.

#### Scenario: Scheduled run is gated

- GIVEN the flag is off
- WHEN the startup background path initializes
- THEN no rebalance timer is started

#### Scenario: Manual trigger

- GIVEN the flag is on and a stored generation
- WHEN an operator calls the manual rebalance trigger
- THEN the global solve runs and applies atomically

### Requirement: Quota-research claim extraction (internal LLM)

The system SHALL extract a structured quota claim from a tier-3 search snapshot by
running the FMO `quota-research` contract through OmniRoute's own in-process LLM
pipeline (`handleChatCore`) with structured JSON output, and SHALL NOT call the FMO
Python client, the FMO Instructor runtime, `POST /api/v1/search`, `fetch` back into
OmniRoute, or any OmniRoute HTTP route for this extraction. The extractor SHALL build
its request itself — resolving the extractor model through `getModelInfo` and
credentials through `getProviderCredentials` — and SHALL pass the same variables the
FMO prompt expects: `provider`, `provider_model_id`, `source_type`, `source_url`,
`text`, and `previous_limit`. The request SHALL be non-streaming and SHALL carry a
`response_format` JSON schema for `QuotaClaimResponse`; the schema SHALL be honored
through the request translators, not assumed as a provider-native JSON mode. The
extractor SHALL read the response body, parse the model's content into a
`QuotaClaimResponse`, and return it to the existing deterministic validator unchanged —
the extractor SHALL NOT itself relax the evidence, cumulative-over-RPM, range, or
reject-unusable rules. A failed, empty, unparseable, or invalid extraction SHALL
resolve to no tier-3 claim (the candidate degrades to tier-4), and SHALL NOT throw into
the planning path. The extraction step SHALL be independently disableable, and when
disabled it SHALL behave exactly as a no-claim result. The fetched search snapshot
(query, provider used, answer text, snippets, evidence URLs, retrieval time, content
hash) SHALL be preserved on the tier-3 result regardless of extraction outcome.

#### Scenario: Snapshot is extracted into a usable claim

- GIVEN a tier-3 search snapshot with answer text and evidence URLs
- WHEN the extractor runs
- THEN it calls `handleChatCore` in-process with the `quota-research` system prompt and
  the rendered input variables
- AND it sends a non-streaming request with a `response_format` JSON schema for
  `QuotaClaimResponse`
- AND it parses the returned content into a `QuotaClaimResponse`
- AND the parsed claim is passed to the existing validator before being trusted

#### Scenario: Extraction never reaches the route boundary

- GIVEN the extractor is invoked
- WHEN it builds and sends its LLM request
- THEN it resolves the model via `getModelInfo` and credentials via
  `getProviderCredentials`
- AND it does not issue an HTTP request to `POST /api/v1/search` or any OmniRoute route
- AND it does not construct a route `Request` or call the FMO Python client or
  Instructor runtime

#### Scenario: Failed or invalid extraction degrades to tier-4

- GIVEN the extractor returns an empty, unparseable, or schema-invalid response
- WHEN the tier-3 result is resolved
- THEN no quota claim is produced and the candidate degrades to tier-4 `none`
- AND no exception propagates into the planning path
- AND the search snapshot is still retained on the result for debug

#### Scenario: Extraction can be disabled

- GIVEN the quota-research extraction step is disabled by config
- WHEN tier-3 is reached for a candidate
- THEN the extractor is not invoked
- AND the candidate degrades to tier-4 `none` exactly as a no-claim result
