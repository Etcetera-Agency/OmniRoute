# fmo-pool-rebalance Specification

## ADDED Requirements

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
