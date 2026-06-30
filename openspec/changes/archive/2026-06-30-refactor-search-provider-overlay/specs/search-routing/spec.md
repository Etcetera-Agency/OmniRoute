## MODIFIED Requirements

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
