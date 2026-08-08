# web-fetch-routing Specification

## Purpose

Define web-fetch provider routing, capability filtering, fallback order, privacy guardrails, and attempt telemetry for public URL content extraction.

## Requirements

### Requirement: Mdream Fetch Provider

The system SHALL fetch public Markdown/text content through the Mdream remote endpoint and return the standard web-fetch response shape when a web-fetch request selects provider `mdream`.

#### Scenario: Mdream Fetches Markdown

GIVEN a request body with `url` set to `https://example.com/path?a=1`
AND `provider` set to `mdream`
AND `format` set to `markdown`
WHEN the request is processed
THEN the system calls `https://mdream.dev/example.com/path?a=1`
AND returns `provider` as `mdream`
AND returns the original `url`
AND returns non-empty `content`

#### Scenario: Mdream Rejects Empty Content

GIVEN Mdream returns HTTP 200 with an empty body
WHEN the request is processed
THEN the system treats the attempt as failed
AND records `empty_content` as the fallback reason when fallback is enabled

### Requirement: Mdream Privacy Guard

The system SHALL reject URLs that are private, internal, authorized, cookie-bearing, secret-bearing, or classified as sensitive health data before any Mdream network call when a web-fetch request could be sent to Mdream.

#### Scenario: Localhost URL Is Blocked

GIVEN a request body with `url` set to `http://localhost:3000/private`
AND `provider` set to `mdream`
WHEN the request is processed
THEN the system rejects the request before calling Mdream
AND returns a client error

#### Scenario: Secret Query Is Blocked

GIVEN a request body with `url` set to `https://example.com/callback?token=secret`
AND `provider` set to `mdream`
WHEN the request is processed
THEN the system rejects the request before calling Mdream
AND does not log the full URL

#### Scenario: Sensitive Health URL Is Blocked

GIVEN a request includes `x-hermes-data-class: sensitive-health`
AND the selected provider would be `mdream`
WHEN the request is processed
THEN the system skips or rejects Mdream before any Mdream network call

### Requirement: Parallel Extract Provider

The system SHALL fetch public URL content through Parallel Extract and return the standard web-fetch response shape when a web-fetch request selects provider `parallel-extract`.

#### Scenario: Parallel Extract Fetches Markdown

GIVEN a request body with `url` set to `https://example.com/path`
AND `provider` set to `parallel-extract`
AND `format` set to `markdown`
AND a valid Parallel API key is configured
WHEN the request is processed
THEN the system calls the Parallel Extract API with the original URL
AND returns `provider` as `parallel-extract`
AND returns the original `url`
AND returns non-empty `content`

#### Scenario: Parallel Extract Requires Credentials

GIVEN a request body with `provider` set to `parallel-extract`
AND no Parallel API key is configured
WHEN the request is processed
THEN the system returns a provider credential error
AND does not attempt another provider unless `fallback` is `true`

#### Scenario: Parallel Extract Skips Unsupported Capability

GIVEN a request body with `format` set to `screenshot`
AND no explicit provider
WHEN the request is processed
THEN the system skips `parallel-extract` as incompatible

### Requirement: Sequential Web Fetch Fallback

The system SHALL attempt compatible providers in this order: `mdream`, `parallel-extract`, `jina-reader`, `tavily-search`, `firecrawl` when a web-fetch request omits `provider`.

#### Scenario: Mdream Fails Then Parallel Succeeds

GIVEN a request body without `provider`
AND Mdream returns a retryable failure
AND Parallel Extract returns non-empty content
WHEN the request is processed
THEN the system returns the Parallel Extract result
AND records the Mdream fallback reason

#### Scenario: Firecrawl Handles Screenshot

GIVEN a request body with `format` set to `screenshot`
AND no explicit provider
WHEN the request is processed
THEN the system skips Mdream, Parallel Extract, Jina Reader, and Tavily Extract as incompatible
AND attempts Firecrawl

### Requirement: Explicit Provider Fallback Control

The system SHALL use only the explicitly requested `provider` unless request body `fallback` is `true` when a web-fetch request includes an explicit `provider`.

#### Scenario: Explicit Provider Without Fallback

GIVEN a request body with `provider` set to `jina-reader`
AND no `fallback` field
WHEN Jina Reader fails with a retryable error
THEN the system returns the Jina Reader error
AND does not attempt Tavily Extract or Firecrawl

#### Scenario: Explicit Provider With Fallback

GIVEN a request body with `provider` set to `jina-reader`
AND `fallback` set to `true`
WHEN Jina Reader fails with a retryable error
THEN the system attempts the next compatible provider in configured order

### Requirement: Web Fetch Attempt Telemetry

The system SHALL record attempt metadata without storing prompt bodies, response bodies, or full secret-bearing URLs when any web-fetch provider attempt completes.

#### Scenario: Telemetry Redacts Secret URL

GIVEN a request URL contains a query parameter named `api_key`
WHEN a provider attempt completes
THEN telemetry stores the URL host
AND telemetry does not store the full URL
AND telemetry stores provider, format, latency, status, content byte count, success, and fallback reason

### Requirement: Web Fetch API Catalog Visibility

The system SHALL document `POST /api/v1/web/fetch` in the live OpenAPI spec so the `/dashboard/endpoint` API catalog lists the web-fetch endpoint with its auth requirement, request body, and response shape.

#### Scenario: Dashboard Lists Web Fetch Endpoint

GIVEN the `/api/v1/web/fetch` route exists
AND the dashboard API catalog loads `/api/openapi/spec`
WHEN the catalog is rendered on `/dashboard/endpoint`
THEN the endpoint list includes `POST /api/v1/web/fetch`
AND the endpoint is grouped under `Web Fetch`
AND the endpoint is marked as requiring bearer API key auth

### Requirement: Mdream Provider Catalog Visibility

The system SHALL expose Mdream as a no-auth web-fetch provider in the dashboard provider catalog when Mdream is registered in the web-fetch routing registry.

#### Scenario: Web Fetch Providers Lists Mdream

GIVEN Mdream is registered as a keyless web-fetch provider
WHEN the dashboard renders the Web Fetch Providers section
THEN the provider list includes `Mdream`
AND the provider is marked as no-auth
AND the provider remains visible when configured-only filtering is enabled

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
