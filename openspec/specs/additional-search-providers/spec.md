# additional-search-providers Specification

## Purpose
Define how OmniRoute evaluates, registers, and normalizes newly approved `/v1/search`
providers while recording rejected candidates so provider expansion stays explicit and
testable.

## Requirements
### Requirement: Additional Provider Registration
The system SHALL register each additional provider in the search provider registry with provider ID, display name, base URL, method, auth type, supported search types, timeout, cache TTL, and cost/quota metadata when it is implemented.

#### Scenario: Registered Provider Appears In List
GIVEN `parallel-search` is implemented
WHEN `GET /v1/search` lists providers
THEN the provider list includes `parallel-search`
AND its supported search types are present

### Requirement: Standard Search Response Contract
The system SHALL normalize results into the existing `SearchResponse` and `SearchResult` shapes when any additional search provider returns results.

#### Scenario: Valid URL Result
GIVEN `parallel-search` returns a result with title, snippet, and URL
WHEN the response is normalized
THEN OmniRoute returns a `SearchResult` with title, snippet, URL, rank, citation provider, and retrieval timestamp

#### Scenario: Missing URL Dropped
GIVEN a provider returns a result without a valid URL
WHEN the response is normalized
THEN that result is not included in `results`

### Requirement: UniSearch Exclusion
The system SHALL exclude architecture papers or non-API systems from provider implementation scope when evaluating provider candidates from external research.

#### Scenario: UniSearch Is Not Provider
GIVEN UniSearch is identified as a generative search architecture
WHEN additional providers are selected
THEN the system does not add `unisearch` as a `/v1/search` provider
AND records it as research context only

### Requirement: SERP Scraper Duplicate Exclusion
The system SHALL avoid adding duplicates of existing Serper/SearchAPI coverage unless explicitly approved when evaluating additional Google SERP wrapper providers.

#### Scenario: SerpAPI Excluded
GIVEN `serpapi-search` is identified as another Google SERP wrapper
AND OmniRoute already has `serper-search` and `searchapi-search`
WHEN additional providers are selected
THEN the system does not add `serpapi-search`

### Requirement: Existing Jina Coverage Exclusion
The system SHALL treat existing `jina-reader` web fetch support and `jina-ai` model support as current coverage unless a distinct Jina search endpoint is explicitly approved when evaluating Jina as an additional search candidate.

#### Scenario: Jina Search Excluded
GIVEN OmniRoute already supports `jina-reader` for web fetch
AND OmniRoute already supports `jina-ai` for embeddings or rerank
WHEN additional providers are selected
THEN the system does not add `jina-search`
AND records Jina as existing coverage rather than new provider scope

### Requirement: Project-Excluded Provider Candidates
The system SHALL exclude candidates rejected by project decision from this slice when evaluating additional provider candidates.

#### Scenario: Rejected Providers Excluded
GIVEN `kagi-search`, `xai-search`, `duckduckgo-search`, and `bing-search` were rejected for this slice
WHEN additional providers are selected
THEN the system does not add those provider IDs
AND records them as excluded candidates

### Requirement: SearXNG Wrapper Exclusion
The system SHALL rely on existing direct `searxng-search` support unless a wrapper adds a separately approved capability when evaluating SearXNG wrapper providers.

#### Scenario: Searcharvester Excluded
GIVEN OmniRoute already supports direct `searxng-search`
WHEN additional providers are selected for this slice
THEN the system does not add `searcharvester-search`
AND records it as excluded because the wrapper is not needed
