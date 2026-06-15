# routing-config-ui Specification

## Purpose
Defines operator-managed automatic routing configuration for search and web-fetch providers, including persisted priority order, per-provider auto-routing disablement, reset behavior, and management-auth validation.

## Requirements
### Requirement: Editable Search Provider Order
The system SHALL persist an operator-edited search provider priority order and use it for `/v1/search` automatic routing, overriding the built-in default order, for the main (`kind: "search"`) chain.

#### Scenario: Operator Reorders Search Providers
GIVEN the built-in search order starts with `brave-search` then `tavily-search`
AND an operator saves an override placing `tavily-search` before `brave-search`
WHEN a `/v1/search` request omits `provider`
THEN the system attempts `tavily-search` before `brave-search`

#### Scenario: New Provider Missing From Override Stays Routable
GIVEN an operator override lists only some registered search providers
AND a newly registered provider is absent from the override
WHEN the effective search order is built
THEN the new provider is appended after the override entries
AND remains eligible for automatic routing

### Requirement: Editable Web-Fetch Provider Order
The system SHALL persist an operator-edited web-fetch provider order and use it for `/v1/web/fetch` automatic fallback, overriding the built-in default order, for the additional (`kind: "fetch"`) chain.

#### Scenario: Operator Reorders Fetch Providers
GIVEN the built-in fetch order is `mdream`, `parallel-extract`, `jina-reader`, `tavily-search`, `firecrawl`
AND an operator saves an override placing `jina-reader` first
WHEN a `/v1/web/fetch` request omits `provider`
THEN the system attempts `jina-reader` before the other compatible providers

### Requirement: Provider Enable Toggle
The system SHALL let an operator exclude a provider from automatic routing without deleting its credentials and without blocking explicit `provider:` selection.

#### Scenario: Disabled Provider Skipped In Auto Routing
GIVEN an operator disables `exa-search` for automatic routing
WHEN a `/v1/search` request omits `provider`
THEN the system does not attempt `exa-search`
AND `exa-search` credentials remain stored

#### Scenario: Disabled Provider Still Explicitly Callable
GIVEN `exa-search` is disabled for automatic routing
WHEN a `/v1/search` request sets `provider: "exa-search"`
THEN the system executes `exa-search`

### Requirement: Routing Override Reset
The system SHALL let an operator clear a routing override and revert the endpoint to its built-in default order.

#### Scenario: Reset Restores Default Order
GIVEN an operator has saved a custom search order override
WHEN the operator resets the search routing override
THEN automatic routing uses the built-in default order

### Requirement: Routing Override Management Auth
The system SHALL require management authentication to read or write routing overrides and SHALL validate provider IDs against the endpoint registry.

#### Scenario: Unauthorized Write Rejected
GIVEN a request to update a routing override without management auth
WHEN the write endpoint is called
THEN the system returns an authentication error
AND does not change the persisted override

#### Scenario: Unknown Provider Rejected
GIVEN a routing override body references a provider ID not in the endpoint registry
WHEN the write endpoint is called
THEN the system rejects the request
AND does not persist the override
