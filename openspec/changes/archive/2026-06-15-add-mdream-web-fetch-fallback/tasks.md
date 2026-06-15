# Implementation Tasks

## Phase 1: Provider and Validation

- [x] 1.1 Verify the live Mdream endpoint contract (path prefix, scheme handling, headers) before coding, then add `open-sse/executors/mdream-fetch.ts` with live-verified Mdream raw URL construction, timeout, empty-content rejection, and standard `WebFetchResponse` output.
- [x] 1.2 Add `open-sse/executors/parallel-extract.ts` with Parallel Extract request construction, credential handling, timeout, empty-content rejection, and standard `WebFetchResponse` output.
- [x] 1.3 Update `v1WebFetchSchema` so `provider` accepts `mdream` and `parallel-extract`, and request body accepts optional `fallback`.
- [x] 1.4 Add a shared web-fetch provider definition list or registry for `mdream`, `parallel-extract`, `jina-reader`, `tavily-search`, and `firecrawl`.

## Phase 2: Routing and Safety

- [x] 2.1 Refactor `open-sse/handlers/webFetch.ts` to build a compatible provider chain for each request.
- [x] 2.2 Add Mdream capability filtering for non-markdown formats, selector waiting, and depth greater than zero.
- [x] 2.3 Add Parallel Extract capability filtering for screenshots, selector waiting, unsupported link extraction, and depth greater than zero.
- [x] 2.4 Add Mdream privacy/SSRF filter before any request to the live-verified Mdream raw endpoint, reusing the existing OmniRoute outbound URL guard / `ssrf-req-filter` for IP/host classification and adding only the Mdream-specific checks (cookies, Authorization, secret query keys, `sensitive-health`).
- [x] 2.5 Implement fallback classification for retryable provider failures, credential failures, empty content, and terminal page errors.

## Phase 3: API and Catalog

- [x] 3.1 Update `src/app/api/v1/web/fetch/route.ts` to resolve credentials per attempted provider while allowing Mdream without an API key and requiring Parallel credentials. Define the shared `PARALLEL_API_KEY` resolution here (reused by `parallel-search` in `add-additional-search-providers`).
- [x] 3.2 Update `src/app/api/search/providers/route.ts` so Mdream and Parallel Extract appear as fetch providers with capability metadata.
- [x] 3.3 Preserve response shape and CORS behavior for existing clients.
- [x] 3.4 Defer the `parallel` provider management entry to repo-level `openspec/TODO.md`; this slice resolves `parallel-extract` through the `parallel` credential id plus `PARALLEL_API_KEY` environment fallback.
- [x] 3.5 Defer visual `/dashboard/search-tools` catalog verification to repo-level `openspec/TODO.md`; this slice covers the API catalog contract with integration tests.

## Phase 4: Quality

- [x] 4.1 Add unit tests for Mdream URL path/query/scheme preservation and empty-content rejection.
- [x] 4.2 Add unit tests for Parallel Extract request construction, response normalization, credential handling, and empty-content rejection.
- [x] 4.3 Add SSRF/privacy tests for localhost, private IPs, secret query parameters, cookies, authorization, and `sensitive-health`.
- [x] 4.4 Add fallback tests for ordered attempts and explicit provider behavior.
- [x] 4.5 Add integration coverage for `POST /v1/web/fetch`.
- [x] 4.6 Run `npm run typecheck:core`, targeted web-fetch tests, and `npm run check:fetch-targets`.
