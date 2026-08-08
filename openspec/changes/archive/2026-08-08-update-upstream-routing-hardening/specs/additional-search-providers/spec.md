## ADDED Requirements

### Requirement: Shared Native Firecrawl Alias Integration

The system SHALL use the native Firecrawl v2 request builder and response normalizer for both
the upstream `firecrawl` provider and the Hermes overlay `firecrawl-search` alias. The shared
helper SHALL accept a provider variant for alias-only body options, timeout and quota metadata,
valid-URL filtering, and citation provider ID. Both provider IDs SHALL remain registered,
schema-valid, catalog-visible, and independently selectable until an explicit canonicalization
change updates those surfaces.

#### Scenario: Alias uses the shared request path

- **GIVEN** a request explicitly selects `firecrawl-search`
- **WHEN** the request builder is invoked
- **THEN** it uses the shared native Firecrawl v2 builder
- **AND** it preserves the alias's configured timeout and quota metadata
- **AND** it retains alias-only invalid-URL and scrape/body options

#### Scenario: Alias normalizes only its selected result bucket

- **GIVEN** Firecrawl returns both `data.web` and `data.news` arrays
- **AND** the request has `search_type` set to `news`
- **WHEN** the `firecrawl-search` response is normalized
- **THEN** only `data.news` is considered
- **AND** results without valid URLs are dropped according to the alias policy
- **AND** each citation reports provider `firecrawl-search`

#### Scenario: Native Firecrawl behavior stays canonical

- **GIVEN** a request explicitly selects upstream provider `firecrawl`
- **WHEN** its request and response are built through the shared helper
- **THEN** native Firecrawl defaults are used without alias-only body flags
- **AND** citations report provider `firecrawl`

#### Scenario: Both IDs remain visible

- **GIVEN** the merged provider registry is loaded
- **WHEN** `/v1/search` validation or provider catalog listing runs
- **THEN** both `firecrawl` and `firecrawl-search` are accepted and listed
- **AND** no ID is silently renamed or removed by this change
