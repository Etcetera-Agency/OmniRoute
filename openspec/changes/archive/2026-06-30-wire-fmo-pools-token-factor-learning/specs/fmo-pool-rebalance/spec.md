# fmo-pool-rebalance Specification

## MODIFIED Requirements

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
surface can explain the source.

The system SHALL own the request-equivalents conversion algebra and keep
`tokens_per_request` a single global learned factor. The global factor SHALL be
learned from request-path observations of `observed_tokens / observed_requests`
(clamped per recalibration) and SHALL persist across restarts, seeding from the
persisted value or the default when none exists; it SHALL NOT remain pinned to the
seed default in production. The class-to-weight table SHALL be keyed by the contract
`workload_class` vocabulary (`light`, `chat`, `reasoning`, `tools`) with a `default`
fallback, so a declared class resolves to its own weight and does not silently fall to
`default`. The system SHALL compute candidate capacity as
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
