# Spec Delta: Web Fetch Routing

## ADDED Requirements

### Requirement: Mdream Fetch Provider

The system SHALL fetch public Markdown/text content through the Mdream remote endpoint and return the standard web-fetch response shape when a web-fetch request selects provider `mdream`.

#### Scenario: Mdream Fetches Markdown

GIVEN a request body with `url` set to `https://example.com/path?a=1`
AND `provider` set to `mdream`
AND `format` set to `markdown`
WHEN the request is processed
THEN the system calls `https://mdream.dev/p/example.com/path?a=1`
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
