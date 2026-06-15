# Implementation Tasks

## Phase 1: Provider Registry

- [x] 1.1 Add provider metadata for Batch 1 providers (`parallel-search`, `firecrawl-search`).
- [x] 1.2 Record excluded candidates in docs and tests where provider allowlists are documented.
- [x] 1.3 Add credential fallback mappings only where providers intentionally reuse existing credentials. For `parallel-search`, reuse the shared `PARALLEL_API_KEY` resolution defined alongside `parallel-extract` in `add-mdream-web-fetch-fallback`.

## Phase 2: Adapters

- [x] 2.1 Implement request builders for `parallel-search` and `firecrawl-search`.
- [x] 2.2 Implement response normalizers for `parallel-search` and `firecrawl-search`.
- [x] 2.3 Add negative coverage to ensure excluded candidates are not registered by this slice.

## Phase 3: Validation and Catalog

- [x] 3.1 Update `/v1/search` provider validation if provider IDs are enumerated.
- [x] 3.2 Update `GET /v1/search` provider list.
- [x] 3.3 Update `GET /api/search/providers` catalog/status output so `parallel-search` and `firecrawl-search` appear with status + Configure links.
- [x] 3.4 Wire credential entry through the existing Providers UI: `parallel-search` reuses the `parallel` connection in `src/shared/constants/providers.ts` (created by `add-mdream-web-fetch-fallback`; add it here if that change has not landed), and `firecrawl-search` reuses the existing `firecrawl` connection. No new bespoke key-entry UI is added.
- [x] 3.5 Add docs for credentials, quota notes, and capability notes.

## Phase 4: Quality

- [x] 4.1 Add unit tests for each provider normalizer.
- [x] 4.2 Add request-builder tests for auth headers and query parameters.
- [x] 4.3 Add route tests for explicit provider calls.
- [x] 4.4 Run targeted search tests, `npm run typecheck:core`, and `npm run lint`.
