# Implementation Tasks

## Phase 1: Routing Configuration

- [x] 1.1 Add configurable search provider order with default Hermes order.
- [x] 1.2 Limit the default order to providers already registered in `open-sse/config/searchRegistry.ts`.
- [x] 1.3 Expose configured order and current status through `src/app/api/search/providers/route.ts`.

## Phase 2: Runtime Fallback

- [x] 2.1 Update `/api/v1/search/route.ts` auto-selection to use configured priority order instead of cheapest-first order.
- [x] 2.2 Preserve explicit provider behavior as single-provider execution. Do not add a `/v1/search` explicit fallback flag in this slice.
- [x] 2.3 Add fallback classification for retryable status codes, timeout, network errors, credential failures, cooldown, quota exhaustion, and empty usable results.
- [x] 2.4 Ensure terminal client/page errors do not always trigger the whole provider chain.

## Phase 3: Quality

- [x] 3.1 Add tests for configured order.
- [x] 3.2 Add tests for explicit provider single-provider behavior.
- [x] 3.3 Add tests for cooldown/credential failure skip behavior.
- [x] 3.4 Run targeted search tests, `npm run typecheck:core`, and `npm run lint`.
