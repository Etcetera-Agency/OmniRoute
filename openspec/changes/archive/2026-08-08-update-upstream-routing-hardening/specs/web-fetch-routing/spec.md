## ADDED Requirements

### Requirement: Web Fetch Credential Quota Preflight

The system SHALL resolve each web-fetch provider credential through
`getProviderCredentialsWithQuotaPreflight` before making an upstream request. Automatic
web-fetch routing SHALL skip preflight-blocked providers and continue through the effective
configured order while preserving capability filtering, cooldowns, retries, `mdream`,
`parallel-extract`, and fallback flags. Explicit provider requests SHALL return their own
rate-limited result unless the request explicitly enables fallback.

#### Scenario: Preflight-blocked provider is skipped automatically

- **GIVEN** the effective web-fetch order starts with `firecrawl` followed by `jina-reader`
- **AND** Firecrawl's selected connection is rejected by quota preflight
- **AND** Jina Reader has usable credentials and supports the requested format
- **WHEN** a web-fetch request omits `provider`
- **THEN** no Firecrawl request is sent
- **AND** Jina Reader is attempted
- **AND** the response identifies `jina-reader` as the provider

#### Scenario: Explicit preflight block does not silently fall back

- **GIVEN** a request explicitly selects `firecrawl`
- **AND** its connection is rejected by quota preflight
- **AND** another compatible provider has usable credentials
- **WHEN** the request has no `fallback` flag or sets `fallback` to `false`
- **THEN** the response is rate limited for Firecrawl
- **AND** the other provider is not attempted

#### Scenario: Explicit fallback opt-in uses the remaining order

- **GIVEN** a request explicitly selects `jina-reader` with `fallback: true`
- **AND** Jina Reader is rejected by quota preflight or returns a retryable quota status
- **AND** the next configured compatible provider is usable
- **WHEN** the request is processed
- **THEN** the next provider is attempted
- **AND** the response identifies that provider

#### Scenario: Exhausted automatic pool returns one retryable response

- **GIVEN** every compatible automatic provider is preflight-blocked or returns a quota status
- **WHEN** the web-fetch request is processed
- **THEN** the gateway returns one rate-limited response
- **AND** the response includes retry metadata
- **AND** the gateway does not return a misleading missing-credentials error

#### Scenario: Non-quota client error does not trigger fallback

- **GIVEN** automatic Firecrawl returns HTTP 400 for an invalid request
- **AND** Jina Reader is configured
- **WHEN** the web-fetch request is processed
- **THEN** the gateway returns the Firecrawl client error
- **AND** Jina Reader is not attempted

### Requirement: Firecrawl Per-Credential Base and Self-Hosted Authentication

The system SHALL resolve the Firecrawl fetch base URL using `FIRECRAWL_BASE_URL`, then the
credential's canonical `baseUrl`, then `providerSpecificData.baseUrl`, then the public cloud
default. The resolver SHALL remove trailing slashes. A custom/self-hosted base SHALL permit an
empty API key and SHALL omit the `Authorization` header; the public cloud base SHALL continue to
require an API key.

#### Scenario: Direct credential base URL is used

- **GIVEN** a Firecrawl connection contains `baseUrl: "http://firecrawl.internal/"`
- **AND** `FIRECRAWL_BASE_URL` is unset
- **WHEN** a Firecrawl fetch executes
- **THEN** the request is sent to `http://firecrawl.internal/v1/scrape`
- **AND** the trailing slash is not duplicated

#### Scenario: Nested provider data remains supported

- **GIVEN** a Firecrawl connection has no direct `baseUrl`
- **AND** its `providerSpecificData.baseUrl` is `http://firecrawl.internal/`
- **AND** `FIRECRAWL_BASE_URL` is unset
- **WHEN** a Firecrawl fetch executes
- **THEN** the request uses the nested custom base URL

#### Scenario: Environment override wins

- **GIVEN** `FIRECRAWL_BASE_URL` and a per-credential base URL are both configured
- **WHEN** a Firecrawl fetch executes
- **THEN** the environment base is used
- **AND** the credential base is not used for that request

#### Scenario: Self-hosted fetch needs no key

- **GIVEN** a custom Firecrawl base is selected
- **AND** the selected connection has no API key
- **WHEN** a Firecrawl fetch executes
- **THEN** the request is sent without an `Authorization` header
- **AND** the fetch is not rejected solely for missing credentials

#### Scenario: Public cloud still requires a key

- **GIVEN** no custom Firecrawl base is selected
- **AND** the selected connection has no API key
- **WHEN** a Firecrawl fetch executes
- **THEN** the executor returns HTTP 401
- **AND** no unauthenticated cloud request is sent
