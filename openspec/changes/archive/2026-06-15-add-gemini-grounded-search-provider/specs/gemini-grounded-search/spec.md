# Spec Delta: Gemini Grounded Search

## ADDED Requirements

### Requirement: Gemini Grounded Search Provider
The system SHALL execute a Gemini request with native Google Search grounding and return the standard OmniRoute search response shape when `/v1/search` is called with provider `gemini-grounded-search`.

#### Scenario: Explicit Gemini Grounded Search
GIVEN Gemini credentials are configured
AND request body contains `provider: "gemini-grounded-search"`
AND `query: "OpenAI official website"`
WHEN `/v1/search` processes the request
THEN the system calls Gemini with `googleSearch` grounding enabled
AND returns `provider` as `gemini-grounded-search`
AND returns a standard search response

#### Scenario: Provider Listed
GIVEN `gemini-grounded-search` is registered
WHEN `GET /v1/search` lists search providers
THEN the provider list includes `gemini-grounded-search`

### Requirement: Grounding Metadata Normalization
The system SHALL map valid grounded URLs to `SearchResult[]` and place the model answer in `answer.text` when Gemini returns grounded web sources.

#### Scenario: Valid Grounding Chunk
GIVEN Gemini response contains `groundingMetadata.groundingChunks[0].web.uri` equal to `https://example.com`
AND `groundingMetadata.groundingChunks[0].web.title` equal to `Example`
WHEN the response is normalized
THEN the first result URL is `https://example.com`
AND the first result title is `Example`
AND `answer.text` contains the Gemini answer text

#### Scenario: Missing URL Dropped
GIVEN Gemini response contains grounding chunks without valid `http` or `https` URLs
WHEN the response is normalized
THEN those chunks are not returned as search results

#### Scenario: Duplicate URLs Deduped
GIVEN Gemini response contains two grounding chunks with the same normalized URL
WHEN the response is normalized
THEN only one search result is returned for that URL

### Requirement: Credential Reuse
The system SHALL resolve credentials from an existing Gemini provider configuration rather than requiring a Google Programmable Search Engine `cx` when `gemini-grounded-search` executes.

#### Scenario: Gemini Credentials Used
GIVEN a Gemini provider API key is configured
AND no `google-pse-search` `cx` exists
WHEN `gemini-grounded-search` executes
THEN the system uses Gemini credentials
AND does not require `cx`

### Requirement: Automatic Routing Position
The system SHALL place `gemini-grounded-search` as the final fallback entry in the configured automatic search order, after the keyed SERP and search-API providers.

#### Scenario: Reached Only As Last Resort
GIVEN the configured search order ends with `perplexity-search` then `gemini-grounded-search`
AND every earlier configured provider is unavailable or returns no usable result
WHEN a `/v1/search` request omits `provider`
THEN the system attempts `gemini-grounded-search` last
AND does not attempt it before any earlier configured provider

### Requirement: Automatic Fallback Compatibility
The system SHALL treat missing valid grounded URLs as an unusable result eligible for fallback when automatic search routing uses `gemini-grounded-search`.

#### Scenario: No Valid Grounded URLs
GIVEN `gemini-grounded-search` is in the automatic provider chain
AND Gemini returns no valid grounded URLs
WHEN the request is processed
THEN the system records an unusable result for `gemini-grounded-search`
AND attempts the next configured provider when one exists

