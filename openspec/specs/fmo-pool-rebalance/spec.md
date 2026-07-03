# fmo-pool-rebalance Specification

## Purpose

Define the FMO pool rebalance contract, planning inputs, solve behavior, tail
guardrails, and apply semantics used by the Hermes-managed OmniRoute fork.

## Requirements

### Requirement: Pool spec ingestion

The system SHALL accept a versioned `fmo-pools/v1` generation on a dedicated seam
(`PUT/POST /api/fmo/pools`) behind the `OMNIROUTE_FMO_POOLS_ENABLED` feature flag,
require management authentication for pool writes, validate pool writes against a Zod
schema, and store accepted pools. When the flag is off the seam SHALL be inert and
OmniRoute behavior SHALL equal upstream.

The API bridge SHALL expose the pool seam methods FMO needs in production:
`PUT /api/fmo/pools` and `POST /api/fmo/pools`, preserving the caller's management
authentication headers. `/api/fmo/usage` SHALL NOT be a required FMO publisher
contract endpoint. The bridge SHALL NOT expose direct legacy FMO combo-write routes as
the production writer path; FMO publishes pool specs and OmniRoute applies combos
internally.

The accepted shape SHALL be the canonical publisher contract: a top-level
`contract_version` literal `fmo-pools/v1`, a `generation` string, an optional
`generated_at`, a required `rebalance` object, and a non-empty `pools` array.
`rebalance.interval_minutes` SHALL be a positive integer cadence chosen by FMO.
Each pool SHALL carry `pool_id`, `combo_id`, a `demand` object whose
`requests_per_day` is any positive finite number and whose optional `consumers` is a
positive integer count alongside an optional `workload_class`, and a `constraints`
object (`free_only`, `capabilities`, `min_context_tokens`, and a `quality_band` intent
with `min`, `max`, `category`, and `relax` of `{ max_delta, when }`), plus a `tail`
intent object. The system SHALL reject unknown or breaking contract shape and SHALL
NOT invent a default context lower bound.

Pool-write idempotency SHALL be keyed by the payload hash supplied as
`Idempotency-Key`, but idempotency SHALL only deduplicate the stored pool generation
record. Every successful `PUT/POST /api/fmo/pools` call SHALL build and apply the
OmniRoute seating plan, even when the payload and accepted generation are identical to
the current stored generation. This preserves a manual rebalance path without a
separate rebalance route. The system SHALL fail the whole generation when any
referenced `combo_id` does not exist; it SHALL NOT create, delete, or synthesize
combos. Storing a generation SHALL immediately build and apply the OmniRoute seating
plan for that generation. The scheduled OmniRoute self-rebalance loop SHALL then
re-apply the latest accepted generation using `rebalance.interval_minutes`.
`POST /api/fmo/rebalance` SHALL be removed; rebalance is an internal OmniRoute
function/job, not an API contract.

The self-rebalance scheduler SHALL reuse OmniRoute's existing startup background
service pattern (`instrumentation-node` plus an internal timer). The system SHALL NOT
introduce a new cron service, queue worker, or external scheduler framework for this
slice. The timer SHALL be inactive until an accepted pool generation exists. After
each successful pool publish, the timer SHALL use the latest
`rebalance.interval_minutes` value for subsequent ticks.

#### Scenario: Bridge accepts pool publish

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is true and management auth is valid
- WHEN FMO calls `PUT /api/fmo/pools` through the API bridge
- THEN the bridge forwards the request to the app route with auth headers intact
- AND the generation is validated, stored, planned, and applied
- AND future self-rebalance uses the published `rebalance.interval_minutes` cadence

#### Scenario: Pool publish applies atomically

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is true
- AND FMO publishes a valid generation with `rebalance.interval_minutes = 60`
- WHEN `PUT /api/fmo/pools` succeeds
- THEN OmniRoute stores the generation and applies the computed combo model seating in the same accepted flow
- AND the next scheduled self-rebalance is based on the same accepted generation and the 60 minute cadence
- AND no `POST /api/fmo/rebalance` route exists

#### Scenario: Identical pool publish still rebalances

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is true
- AND generation `gen-1` is already accepted and applied
- AND OmniRoute runtime state has changed without a new FMO pool payload
- WHEN FMO sends the same `fmo-pools/v1` payload and idempotency key again to `PUT /api/fmo/pools`
- THEN OmniRoute may reuse the stored generation record
- BUT it still rebuilds and applies a fresh seating plan against current runtime state
- AND the response reports the new apply result

#### Scenario: Scheduler uses existing startup timer pattern

- GIVEN OmniRoute starts with background services enabled
- WHEN an accepted FMO pool generation exists with `rebalance.interval_minutes = 60`
- THEN the existing FMO self-rebalance startup service schedules an internal timer for that cadence
- AND no cron service, queue worker, or external scheduler is required

#### Scenario: Pool publish updates scheduler cadence

- GIVEN the FMO self-rebalance scheduler is running for generation `gen-1`
- WHEN `/api/fmo/pools` accepts generation `gen-2` with `rebalance.interval_minutes = 15`
- THEN subsequent self-rebalance ticks use the 15 minute cadence
- AND they rebuild/apply `gen-2` against current OmniRoute runtime state

#### Scenario: Usage endpoint not required

- GIVEN `OMNIROUTE_FMO_POOLS_ENABLED` is true
- AND `PUT /api/fmo/pools` accepts a valid generation
- WHEN `/api/fmo/usage` is absent or disabled
- THEN pool publish is still a valid contract flow
- AND no demand recalibration is expected from OmniRoute usage

#### Scenario: Legacy combo write denied

- GIVEN FMO pool publishing is the active writer path
- WHEN a client calls a legacy direct combo-write route such as `PUT /api/combos/fmo-routing` through the API bridge
- THEN the bridge denies the write
- AND no combo row is modified through that legacy path

### Requirement: Shared contract fixture conformance

The system SHALL keep one canonical `fmo-pools/v1` golden fixture that is byte-identical
to the copy used by the FMO publisher, and SHALL use it as the single source of contract
truth on both sides. A conformance test SHALL load that fixture and assert the ingester
accepts it verbatim, with no field coercions, so any shape drift between the publisher
and the ingester fails a test rather than failing silently in production.

#### Scenario: Canonical fixture is accepted verbatim

- GIVEN the shared canonical `fmo-pools/v1` fixture
- WHEN it is validated against the ingestion schema
- THEN validation succeeds with no coercion
- AND the fixture bytes match the FMO publisher's copy of the same fixture

#### Scenario: Drift from the fixture fails a test

- GIVEN a change to either side's contract shape that diverges from the shared fixture
- WHEN the conformance test runs
- THEN the test fails

### Requirement: Contract-to-planning mapping

The system SHALL map each stored canonical pool spec into the internal planning pool the
solve consumes, without losing any contract-owned field. It SHALL map `workload_class`
to the capacity factor input so that `tokens_per_request = max(workload_class weight,
global factor)` receives the declared class, and SHALL fall back to the global factor
only when `workload_class` is absent. It SHALL map `constraints.capabilities` to the
required-capability gate, `constraints.min_context_tokens` to the context gate,
`constraints.free_only` to the free gate, and `quality_band` (`min`, `max`, `category`,
`relax.max_delta`) to the band resolution. The mapping SHALL NOT relax capability,
context, or free gates, and SHALL carry the `tail` intent only (no members).

#### Scenario: Workload class reaches the capacity algebra

- GIVEN a stored pool whose demand declares `workload_class`
- WHEN planning capacity is computed for a candidate
- THEN `tokens_per_request` uses `max(workload_class weight, global factor)`
- AND a pool that omits `workload_class` uses the global factor

#### Scenario: Capabilities and band map into the solve gates

- GIVEN a stored pool with `capabilities`, `min_context_tokens`, `free_only`, and a
  `quality_band` with `relax.max_delta`
- WHEN the planning pool is built
- THEN capabilities, context, and free become hard gates
- AND the quality band with its relax delta becomes the soft band
- AND the tail intent carries no members

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
snippets, evidence URLs, retrieval time, and content hash so the planning/debug surface
can explain the source.

The system SHALL own the request-equivalents conversion algebra and keep
`tokens_per_request` a single global learned factor. The global factor SHALL be learned
from request-path observations of `observed_tokens / observed_requests` (clamped per
recalibration) and SHALL persist across restarts, seeding from the persisted value or the
default when none exists; it SHALL NOT remain pinned to the seed default in production.
The class-to-weight table SHALL be keyed by the contract `workload_class` vocabulary
(`light`, `chat`, `reasoning`, `tools`) with a `default` fallback, so a declared class
resolves to its own weight and does not silently fall to `default`. The system SHALL
compute candidate capacity as `tokens_per_request = max(workload_class weight, global
factor)` and fall back to the global factor when `workload_class` is omitted.

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

#### Scenario: Declared class resolves to its own weight

- GIVEN a pool with `workload_class = reasoning` or `tools`
- WHEN capacity is computed
- THEN the class resolves to its own weight in the table
- AND it does not silently fall back to the `default` weight

#### Scenario: Global factor learns from request-path observation

- GIVEN a request-path observation of total tokens and request count over a window
- WHEN the factor is recalibrated
- THEN `observeFmoTokensPerRequest` updates the global factor from `tokens / requests`
- AND the new value is clamped and persisted
- AND a later capacity computation uses the learned factor, not the seed default

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
relax the AA band within `max_delta`, then in-band higher-capability overflow. Step 3
higher-capability overflow SHALL be defined by capability surplus — a candidate whose
capability set is a strict superset of the pool's required capabilities — and SHALL NOT
be defined by an intelligence score above the band maximum; the score SHALL only order
candidates within a step, not select the step. The system SHALL relax the AA band before
spending higher-capability overflow candidates, and SHALL NOT relax capability, context,
or free gates. Higher-capability overflow SHALL be allowed only after the stricter pools
that need those rarer-capability candidates are covered.

#### Scenario: Relax precedes overflow

- GIVEN a pool underfilled after exact-fit in-band
- WHEN the ladder continues
- THEN the band is relaxed within `max_delta` and refilled before any higher-capability overflow is spent

#### Scenario: Overflow is keyed on capability surplus, not score

- GIVEN a candidate that is capability-equal to the pool but scores above the band maximum
- WHEN the overflow step runs
- THEN that candidate is not admitted as higher-capability overflow
- AND only candidates whose capabilities are a strict superset of the pool's requirements are admitted

#### Scenario: Stricter pool covered before overflow spends its candidate

- GIVEN a rarer-capability candidate needed by a stricter pool
- WHEN a less-specific pool reaches its overflow step
- THEN the candidate is spent on the less-specific pool only after the stricter pool is covered

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
`connectionId` as a hard rule while that account is alive and not exhausted, adding new
accounts at the margin rather than reshuffling placed pins; this retention SHALL NOT be
reducible to a soft scoring nudge that a small input shift can overturn. Stability SHALL
apply only among eligible candidates and SHALL NOT override capability, context, band,
free, or quota gates; a degraded incumbent SHALL be dropped immediately. The system
SHALL NOT mix account-pinned and account-unpinned entries for the same provider in one
generation, and SHALL enforce this with an explicit per-provider assertion that fails the
generation and logs the violation when both pinned and unpinned head entries appear for
one provider. The system SHALL record stability outcomes for every incumbent — `kept`
(survived a within-margin challenger), `displaced` (beaten by a challenger), and
`dropped` (ineligible) — each with a reason.

#### Scenario: Incumbent kept within margin

- GIVEN an incumbent member and a challenger that does not beat the incumbency margin
- WHEN the pool is solved
- THEN the incumbent keeps its seat
- AND the decision record marks it as `kept` with the challenger and delta in the reason

#### Scenario: Incumbent displaced beyond margin

- GIVEN an incumbent member and a challenger that beats the incumbency margin
- WHEN the pool is solved
- THEN the challenger takes the seat
- AND the decision record marks the incumbent as `displaced` with the delta

#### Scenario: Live pin retained as a hard rule

- GIVEN a previous-generation pin that is in-band, capable, not exhausted, and on a live account
- WHEN the next generation is solved after a small input shift
- THEN the pin keeps its `connectionId`
- AND new accounts are added only at the margin for unfilled demand

#### Scenario: Degraded incumbent dropped

- GIVEN an incumbent that fell out of band or exhausted its quota
- WHEN the pool is solved
- THEN the incumbent is dropped immediately with no margin
- AND the decision record carries the `dropped` reason

#### Scenario: No mixed pinning per provider

- GIVEN a provider used across several combos in one generation
- WHEN the plan is built
- THEN that provider's entries are either all account-pinned or all account-unpinned
- AND a mixed-pin plan fails the generation and logs the violation

### Requirement: Config-driven tail

The system SHALL read an approved tail config from a real configured source (a config
file, optionally overridable by an environment path), validated on load, on every combo
rebuild; it SHALL NOT use an always-empty placeholder source. It SHALL filter entries by
the pool's capabilities and context, and append matching entries after the head. Tail
entries SHALL always be account-unpinned and SHALL NOT carry a `connectionId`.
Tail/fallback providers SHALL be a class disjoint from head inventory providers, and the
same config's provider list SHALL be the single source that excludes those providers from
the head inventory snapshot. The tail SHALL NOT be counted as forecast demand capacity
and SHALL be treated as above-quota overflow safety. The system SHALL drop and log any
tail entry whose provider is account-pinned in the same generation's head. A malformed
tail config SHALL be logged and SHALL degrade to an empty tail rather than throwing.

#### Scenario: Approved config entry is appended

- GIVEN an approved tail config with an entry that matches the pool capabilities and context
- WHEN the combo is rebuilt
- THEN the matching entry is appended after the head candidates
- AND it carries no `connectionId`
- AND it does not change the pool's covered-demand calculation

#### Scenario: Tail provider excluded from head from the same source

- GIVEN a provider listed in the approved tail config
- WHEN the head inventory snapshot is built
- THEN that provider is not entered into the head snapshot

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

#### Scenario: Malformed config degrades to empty

- GIVEN an approved tail config that fails schema validation
- WHEN the tail config is read
- THEN the failure is logged
- AND the tail is treated as empty rather than throwing

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

### Requirement: End-to-end rebalance orchestration

The system SHALL compute a rebalance plan server-side by connecting the existing
planning blocks into one pipeline: build the head inventory, resolve each candidate's
intelligence band, resolve its quota by source precedence, compute its
request-equivalent capacity, assemble the solve candidates, and run the one-generation
global solve to produce the plan and decision log. A scheduled run and a manual trigger
SHALL both run this full pipeline. The system SHALL NOT require an externally supplied
list of combo members to materialize a generation, and SHALL NOT materialize empty
combos when an accepted generation exists. The solve SHALL load the previous committed
generation as the incumbency prior (it is not stateless), persist the decision log, and
apply atomically; when an apply aborts, the previous committed generation SHALL remain
fully live. A pool with no eligible head candidate SHALL materialize tail-only and SHALL
log the empty-head outcome, rather than retaining stale members.

#### Scenario: Scheduled run materializes a solved plan

- GIVEN an accepted generation and active connections with eligible candidates
- WHEN the scheduled rebalance runs
- THEN OmniRoute builds the head inventory, resolves band/quota/capacity, and runs the
  solve to produce head + tail members
- AND it materializes the solved members, not empty combos

#### Scenario: Manual trigger computes the plan server-side

- GIVEN an accepted generation
- WHEN `POST /api/fmo/rebalance` is called without a supplied plan body
- THEN OmniRoute computes the plan from inventory and the solve
- AND it does not reject the request for a missing plan

#### Scenario: Incumbency prior is loaded from the last committed generation

- GIVEN a previously committed generation with placed members
- WHEN the next generation is solved
- THEN the previous members are loaded as the incumbency prior
- AND a still-eligible incumbent is kept under the stability margin

#### Scenario: No-candidate pool materializes tail-only

- GIVEN a pool whose constraints exclude every head candidate
- WHEN the generation is solved and applied
- THEN the pool materializes only its compatible config tail
- AND the empty-head outcome is logged
- AND the pool does not retain the previous generation's members

#### Scenario: Aborted apply keeps the previous generation live

- GIVEN a computed plan whose apply fails partway
- WHEN the transaction aborts
- THEN no combo is left half-applied
- AND the previously committed generation remains fully live

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

### Requirement: Pool execution diagnostics boundary

The system SHALL expose OmniRoute-owned pool execution data through diagnostics,
decision logs, and rebalance status endpoints, not as FMO demand recalibration input.
Diagnostics MAY include accepted generation, applied generation, shadow diff, decision
log summary, selected model/account counts, quota/cooldown state, and tail fallback
reasons. These endpoints SHALL be read-only, management-auth gated, and feature-flag
gated where they expose FMO pool internals. They SHALL NOT be required by the FMO
publisher pipeline and SHALL NOT describe their output as forecast demand feedback.

#### Scenario: Diagnostics expose execution facts

- GIVEN a pool generation has been applied
- WHEN an operator reads the diagnostics or rebalance status endpoint
- THEN the response can show applied generation, last decision-log summary, selected model/account counts, and tail fallback facts where available
- AND the response is labeled as diagnostics/status data, not demand feedback

#### Scenario: Diagnostics not required for publish

- GIVEN the diagnostics/status endpoint is unavailable
- WHEN FMO publishes a valid `fmo-pools/v1` generation
- THEN publish can still succeed
- AND FMO demand is not recalibrated from missing OmniRoute diagnostics

#### Scenario: Diagnostics stay read-only

- GIVEN a diagnostics/status endpoint is called
- WHEN the route computes execution facts
- THEN no combo rows, pool specs, or generation markers are modified
