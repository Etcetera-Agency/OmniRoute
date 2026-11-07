## ADDED Requirements

### Requirement: M1 Mdream Is a Markdown Fetch Provider

The existing REST/MCP web-fetch inputs and handler SHALL accept provider ID `mdream` for URL-to-Markdown fetch. Omitted format SHALL mean `markdown`; unsupported formats SHALL fail with sanitized 400 before upstream I/O. Mdream SHALL add no query-search types, model IDs, aliases or hosted mode parameters. Existing depth/selector fields SHALL have no Mdream endpoint behavior.

#### Scenario: Explicit Markdown request

- **GIVEN** an admitted client with a public target URL
- **WHEN** REST or MCP submits `provider: mdream` with format omitted
- **THEN** the existing web-fetch pipeline dispatches Mdream in Markdown format
- **AND** no query-search or model route is involved.
- **AND** the MCP tool description identifies Mdream as explicit-only and Markdown-only.

#### Scenario: Unsupported output format

- **WHEN** an admitted request selects Mdream with `html`, `links` or `screenshot`
- **THEN** the result is 400 with a sanitized Markdown-only description
- **AND** no upstream call occurs.

### Requirement: M2 Mdream Requires Explicit Keyless Admission

The system SHALL include Mdream in `EXPLICIT_ONLY_WEB_FETCH_PROVIDERS` and `ANONYMOUS_CAPABLE_WEB_FETCH_PROVIDERS`. An explicit request SHALL work without a configured upstream connection when existing client authentication/policy and keyless connection scope admit it. The system SHALL preserve the existing `noauth` scope rule. Auto-selection and automatic fallback SHALL never attempt Mdream. An explicit Mdream failure SHALL return its result without trying another provider.

#### Scenario: No configured Mdream connection

- **GIVEN** no Mdream connection exists and the client is admitted to keyless providers
- **WHEN** the client explicitly selects Mdream
- **THEN** an anonymous upstream request may execute without asking for an upstream key.

#### Scenario: Scoped client excludes keyless providers

- **GIVEN** a client key has a connection allowlist excluding `noauth` and no admitted Mdream connection
- **WHEN** it explicitly requests Mdream
- **THEN** existing admission rejects the request before upstream I/O.

#### Scenario: Client authentication remains required

- **GIVEN** `REQUIRE_API_KEY` is enabled
- **WHEN** a client omits or supplies invalid OmniRoute authentication
- **THEN** existing authentication rejects the Mdream request before upstream I/O.

#### Scenario: Automatic routing and explicit failure

- **WHEN** an omitted-provider request selects or falls back among configured providers
- **THEN** Mdream is skipped regardless of credentials or another provider's quota failure
- **AND WHEN** an explicit Mdream request fails
- **THEN** no second provider is attempted.

### Requirement: M3 Mdream Sends Only Public Nonsecret Target Data

Mdream SHALL validate targets with `parseAndValidatePublicUrl`, reject forbidden query names and `sensitive-health` before upstream I/O, and return sanitized 400 errors. Upstream requests SHALL use the fixed headers below; caller credentials and inbound headers SHALL NOT be forwarded. Logs and errors SHALL omit raw target URLs, query values, credentials and upstream bodies.

#### Scenario: Unsafe destination rejected

- **WHEN** an admitted Mdream request targets localhost, a private IP, a guard-classified internal host or a URL containing username/password
- **THEN** it fails with 400 before upstream I/O
- **AND** the response contains no rejected URL or credentials.

#### Scenario: HTTP target rejected

- **GIVEN** the hosted URL form omits the source URL scheme
- **WHEN** the caller target uses `http:`
- **THEN** the route returns 400 before upstream I/O because the adapter cannot preserve the requested scheme.

#### Scenario: Secret query names are case insensitive

- **GIVEN** forbidden names are `token`, `api_key`, `apikey`, `key`, `signature`, `session`, `auth` and `code`, matched case-insensitively on parsed query names
- **WHEN** the target contains `?API_KEY=value` or another forbidden query name
- **THEN** it fails with 400 and zero upstream calls
- **AND** logs and response omit the query value.

#### Scenario: Sensitive-health context

- **WHEN** an admitted explicit Mdream request carries `x-hermes-data-class: sensitive-health`
- **THEN** the REST route SHALL reject the request before web-fetch execution
- **AND** the marker is not copied into JSON or upstream headers.

#### Scenario: Authenticated caller uses public fetch

- **GIVEN** valid OmniRoute caller authentication and a public nonsecret target
- **WHEN** Mdream executes
- **THEN** caller Authorization, cookies, configured provider credentials and data-class header are absent from explicitly supplied upstream headers
- **AND** only the adapter's fixed request-header set is supplied; no inbound headers or credentials are copied.
- **AND** that set includes Chrome 131 User-Agent, Markdown Accept, Accept-Language, Mdream Referer, document/navigation Sec-Fetch fields and Upgrade-Insecure-Requests.
- **AND** no browser process is launched.
- **AND** Mdream-path logs SHALL contain at most provider, format and safely parsed hostname, with no raw URL or query.

### Requirement: M4 Mdream Uses One Bounded Hosted Request

The executor SHALL perform one GET to the fixed hosted Mdream URL with a 20,000 ms abort deadline covering request/body reading, clear its timer on every outcome, and perform no retry/fallback. It SHALL normalize nonempty text to `WebFetchResponse`, preserve non-2xx status with fixed sanitized errors, return 502 for empty/network/read failure and 504 for deadline abort. All failures SHALL use existing error helpers.

#### Scenario: Exact hosted URL and ordinary query

- **WHEN** the target is `https://example.com/docs?q=hello#part`
- **THEN** the request URL is `https://mdream.dev/example.com/docs?q=hello`, built from parsed `host`, `pathname` and `search` with source scheme and fragment omitted
- **AND** no local-converter flags or request credentials are appended.
- **AND** the same fixed browser-style HTTP request headers are used for each request.

#### Scenario: Markdown and metadata normalization

- **GIVEN** upstream returns successful text with outer whitespace
- **WHEN** the caller requested metadata
- **THEN** outer whitespace is trimmed, `provider: mdream` and original caller URL are preserved, `links: []` and `screenshot_url: null` are returned
- **AND** metadata is `{title: null, description: null}`
- **AND** without requested metadata the field is null.

#### Scenario: Empty or failing upstream

- **WHEN** successful text is empty or whitespace-only
- **THEN** the result is sanitized 502
- **AND WHEN** upstream returns non-2xx
- **THEN** that status is preserved without returning raw upstream content
- **AND** no second provider or retry is attempted.

#### Scenario: Network or body-read failure

- **WHEN** upstream connection or body reading fails without a deadline abort
- **THEN** the result is sanitized 502 without raw input, upstream body or stack traces.

#### Scenario: Deadline and resource cleanup

- **WHEN** request or body reading reaches the 20,000 ms deadline
- **THEN** its abort signal is triggered and the result is sanitized 504
- **AND** success, upstream failure, abort and network/read failure all clear the request's timer
- **AND** concurrent requests retain independent deadlines.

### Requirement: M5 Mdream Is Selectable in the Fetch Catalog

The authenticated catalog SHALL include one `mdream` entry with name `Mdream`, `kind: fetch`, Markdown-only format, `costPerQuery: 0`, `freeMonthlyQuota: null` and `status: configured` without a connection. The hosted homepage says Mdream stays free; no RPM or monthly allowance is published, so null quota SHALL NOT mean unlimited. Configured means keyless readiness, not live health. Other providers' status rules SHALL remain unchanged.

#### Scenario: Empty credential store

- **GIVEN** no upstream connection exists
- **WHEN** an authenticated client loads `/api/search/providers`
- **THEN** Mdream appears as one selectable fetch provider with Markdown only
- **AND** it does not appear as a search-kind entry or a model.

#### Scenario: Free with unpublished quota

- **GIVEN** Mdream has zero cost and no published monthly quota
- **WHEN** the provider card or scrape config pane displays Mdream
- **THEN** the price is shown as zero cost and no monthly allowance is shown
- **AND** the scrape pane remains usable after Mdream is selected.

#### Scenario: Existing catalog behavior

- **WHEN** existing credentialed providers are configured, missing or rate limited
- **THEN** their existing status resolution remains unchanged
- **AND** management authentication remains required for the catalog.
