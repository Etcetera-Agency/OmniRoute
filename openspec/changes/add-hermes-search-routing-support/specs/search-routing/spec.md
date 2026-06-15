# Spec Delta: Search Routing

## ADDED Requirements

### Requirement: Configured Search Provider Order

The system SHALL select search providers using configured priority order instead of cost-only ordering when `/v1/search` receives a request without explicit `provider`.

#### Scenario: Priority Order Used

GIVEN configured search order starts with `brave-search`, then `tavily-search`
AND both providers are configured
WHEN a `/v1/search` request omits `provider`
THEN the system attempts `brave-search` before `tavily-search`

#### Scenario: Unsupported Search Type Skipped

GIVEN a provider does not support requested `search_type`
WHEN the search chain is built
THEN the system excludes that provider from the attempt chain

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

The system SHALL expose provider order, configured status, credential status, cooldown/rate-limit status when available, and provider kind when an administrator or Hermes management routine reads search provider status.

#### Scenario: Catalog Shows Order

GIVEN search provider order is configured
WHEN `GET /api/search/providers` is called with management auth
THEN each search provider item includes enough data to reconstruct active order and status
