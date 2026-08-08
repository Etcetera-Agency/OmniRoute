# search-routing Specification

## Purpose

Defines how `/v1/search` selects configured search providers, handles automatic provider fallback, preserves explicit provider control, and exposes routing status for management clients.

## Requirements

### Requirement: Configured Search Provider Order

The system SHALL select search providers using configured priority order instead of
cost-only ordering when `/v1/search` receives a request without explicit `provider`.
Hermes-owned search providers SHALL be resolved from the fork-owned overlay registry,
not from the upstream `open-sse/config/searchRegistry.ts` provider map.

#### Scenario: Priority Order Used

GIVEN configured search order starts with `brave-search`, then `tavily-search`
AND both providers are configured
WHEN a `/v1/search` request omits `provider`
THEN the system attempts `brave-search` before `tavily-search`

#### Scenario: Unsupported Search Type Skipped

GIVEN a provider does not support requested `search_type`
WHEN the search chain is built
THEN the system excludes that provider from the attempt chain

#### Scenario: Fork Provider Resolved From Overlay

GIVEN upstream `open-sse/config/searchRegistry.ts` does not register
`parallel-search`, `firecrawl-search`, or `gemini-grounded-search`
WHEN `/v1/search` validates, lists, or executes one of those providers
THEN the fork-owned overlay registry supplies the provider config
AND `open-sse/handlers/search.ts` executes the passed resolved config

### Requirement: Explicit Search Provider Control

The system SHALL execute only the explicitly requested `provider` when `/v1/search` receives a request with explicit `provider`.

#### Scenario: Explicit Provider Without Fallback

GIVEN request body contains `provider: "exa-search"`
AND Exa returns a retryable error
WHEN the request is processed
THEN the system returns the Exa error
AND does not attempt the next provider

### Requirement: Search Runtime Fallback

The system SHALL try the next configured provider after retryable provider failures, credential failures, cooldown, quota exhaustion, timeout, network error, or empty usable results when automatic search routing is used.

#### Scenario: First Provider Cooldown

GIVEN `brave-search` is first in configured order
AND `brave-search` is in cooldown
WHEN `/v1/search` runs without explicit provider
THEN the system skips `brave-search`
AND attempts the next configured compatible provider

#### Scenario: Empty Usable Results

GIVEN a provider returns success with no result containing a valid URL
WHEN automatic search routing is active
THEN the system records an empty usable result fallback reason
AND attempts the next configured compatible provider

### Requirement: Search Provider Observability

The system SHALL expose provider order, configured status, credential status,
cooldown/rate-limit status when available, and provider kind when an administrator or
Hermes management routine reads search provider status. Search provider catalog,
stats, analytics, and validation surfaces SHALL read the merged overlay registry so
Hermes-owned providers remain visible even when the upstream registry only contains
upstream providers.

#### Scenario: Catalog Shows Order

GIVEN search provider order is configured
WHEN `GET /api/search/providers` is called with management auth
THEN each search provider item includes enough data to reconstruct active order and
status

#### Scenario: Fork Providers Stay Visible In Catalog

GIVEN Hermes-owned search providers are defined only in the overlay registry
WHEN `GET /api/search/providers` is called with management auth
THEN the response includes `parallel-search`, `firecrawl-search`, and
`gemini-grounded-search`
AND routing override validation accepts those provider IDs for the search endpoint

### Requirement: Search Credential Quota Preflight

The system SHALL resolve every search attempt through
`getProviderCredentialsWithQuotaPreflight` before making an upstream request. Automatic search
routing SHALL skip a connection rejected by quota preflight and continue through the merged
Hermes overlay order. Explicit provider requests SHALL return the existing rate-limited response
for a rejected connection and SHALL NOT silently try another provider. Credential fallback IDs
and the `RateLimitedCredentials`/`Retry-After` response contract SHALL remain unchanged.

#### Scenario: Preflight-blocked primary falls through

- **GIVEN** configured automatic order starts with `brave-search` followed by `tavily-search`
- **AND** the selected `brave-search` connection reports exhausted quota during preflight
- **AND** `tavily-search` has a usable connection
- **WHEN** `/v1/search` is called without an explicit provider
- **THEN** no request is sent to `brave-search`
- **AND** the request is sent to `tavily-search`
- **AND** the response identifies `tavily-search` as the provider

#### Scenario: Explicit preflight block is rate limited

- **GIVEN** a request explicitly selects `brave-search`
- **AND** its selected connection reports exhausted quota during preflight
- **AND** another search provider has usable credentials
- **WHEN** the request is processed
- **THEN** the response uses the existing rate-limited status and retry metadata
- **AND** no other provider is attempted

#### Scenario: All automatic candidates are preflight blocked

- **GIVEN** every compatible provider in the merged overlay order is rejected by quota preflight
- **WHEN** automatic `/v1/search` routing runs
- **THEN** the response is the existing rate-limited provider response for the first blocked
  candidate
- **AND** the response is not a missing-credentials `400`

### Requirement: Per-Attempt Search Proxy Binding

The system SHALL resolve and apply the proxy for each search provider attempt using that
attempt's connection ID, authenticated API-key policy ID, and provider ID. Primary and fallback
attempts SHALL resolve independently, and proxy telemetry SHALL contain only sanitized target
origin/path, provider, connection identifier, proxy level, status, and latency. Proxy query
strings, search text, API keys, proxy usernames, and proxy passwords SHALL NOT be emitted.

#### Scenario: Primary search uses its assigned proxy

- **GIVEN** the selected primary connection has an account/provider proxy assignment
- **WHEN** its upstream search request is sent
- **THEN** the request is executed inside that connection's proxy context
- **AND** the call log records the selected connection ID

#### Scenario: Fallback search does not inherit primary proxy

- **GIVEN** the primary provider fails with a retryable error
- **AND** the fallback provider has a different connection and proxy assignment
- **WHEN** automatic search fallback runs
- **THEN** the fallback request resolves and uses the fallback connection's proxy
- **AND** the primary proxy context is not reused

#### Scenario: Proxy telemetry is sanitized

- **GIVEN** a search request URL contains query parameters and credentials contain a proxy
  username/password
- **WHEN** a provider attempt emits proxy telemetry
- **THEN** telemetry stores the target origin and pathname only
- **AND** telemetry contains no query string, search query, API key, proxy username, or proxy
  password

#### Scenario: Proxy resolution failure remains fail-open

- **GIVEN** proxy resolution fails for a selected connection
- **WHEN** the search attempt executes
- **THEN** the provider request uses direct transport
- **AND** the search response is not failed solely because proxy lookup failed
