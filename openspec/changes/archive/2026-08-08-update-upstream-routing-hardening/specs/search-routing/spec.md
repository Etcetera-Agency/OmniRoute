## ADDED Requirements

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
