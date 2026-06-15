# Implementation Tasks

## Phase 1: Registry and Credentials

- [x] 1.1 Add `gemini-grounded-search` to `open-sse/config/searchRegistry.ts`.
- [x] 1.2 Add credential fallback so `gemini-grounded-search` can reuse configured Gemini provider credentials.
- [x] 1.3 Expose `gemini-grounded-search` in `GET /v1/search` provider list and `GET /api/search/providers` so it renders in the `/dashboard/search-tools` catalog with a Configure → link pointing at the existing `gemini` connection (no new key-entry UI; credentials are entered via the existing Providers UI).

## Phase 2: Executor Adapter

- [x] 2.1 Add a Gemini grounded search executor/helper.
- [x] 2.2 Build Gemini request with native `googleSearch` tool.
- [x] 2.3 Call Gemini with timeout and sanitized error handling.
- [x] 2.4 Parse answer text and `groundingMetadata.groundingChunks`.
- [x] 2.5 Map grounded web chunks to standard `SearchResult[]`, set `answer` to `{ source, text, model } | null`, dedupe URLs, and respect `max_results`.

## Phase 3: Routing Integration

- [x] 3.1 Wire `gemini-grounded-search` into `handleSearch`.
- [x] 3.2 Append `gemini-grounded-search` as the final entry of the configured search order (after `perplexity-search`) so automatic routing reaches it only as a last resort.
- [x] 3.3 Ensure provider supports `search_type: "web"` and rejects or degrades `news` according to current search validation policy.
- [x] 3.4 Ensure automatic search routing treats no valid grounded URLs as an unusable result eligible for fallback.

## Phase 4: Quality

- [x] 4.1 Add registry and provider list tests.
- [x] 4.2 Add unit tests for grounding metadata normalization.
- [x] 4.3 Add tests for missing URLs and URL dedupe.
- [x] 4.4 Add route test for `POST /v1/search` with `provider: "gemini-grounded-search"`.
- [x] 4.5 Run targeted search tests, `npm run typecheck:core`, and `npm run lint`.
