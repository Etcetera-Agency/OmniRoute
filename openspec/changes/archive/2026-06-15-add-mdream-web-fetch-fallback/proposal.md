# Proposal: Add Mdream Web Fetch Fallback

## Why

Hermes uses OmniRoute as the single URL extraction gateway. The current `/api/v1/web/fetch` route supports Firecrawl, Jina Reader, and Tavily Extract, but it does not expose Mdream or Parallel Extract and does not execute the required provider fallback chain when no explicit provider is requested.

**Context**:

- Hermes calls `POST /v1/web/fetch` for `web_extract` operations.
- Current code validates `provider` as `firecrawl | jina-reader | tavily-search`.
- Current code auto-selects one provider with credentials instead of trying Mdream, Parallel Extract, Jina Reader, Tavily Extract, then Firecrawl in order.
- Mdream is a public remote fetch provider and must not receive private, internal, authorized, cookie-bearing, or sensitive URLs.
- Parallel Extract is a hosted API and should use the same credential and telemetry conventions as other keyed extraction providers.

**Current state**: `/api/v1/web/fetch` chooses one configured provider and delegates once.

**Desired state**: `/api/v1/web/fetch` accepts Mdream and Parallel Extract, applies privacy/SSRF checks, and runs an ordered fallback chain unless an explicit provider is requested without `fallback: true`.

## What Changes

- Add `open-sse/executors/mdream-fetch.ts` as a standalone executor.
- Add `open-sse/executors/parallel-extract.ts` as a standalone executor.
- Extend web-fetch validation to accept `provider: "mdream" | "parallel-extract"` and optional `fallback: boolean`.
- Change `open-sse/handlers/webFetch.ts` to execute an ordered provider chain.
- Keep explicit provider calls single-provider by default.
- Skip Mdream when request capabilities require HTML, links, screenshot, selector waiting, or depth greater than zero.
- Skip Parallel Extract when request capabilities require screenshot, selector waiting, or depth greater than zero.
- Add privacy and SSRF filtering before Mdream receives a URL.
- Add Mdream and Parallel Extract to fetch provider catalog data shown by `src/app/api/search/providers/route.ts`.
- Record per-attempt telemetry without storing full secret-bearing URLs.
- Add unit, route, fallback, path/query, and privacy tests.

## Impact

### Affected Specifications

- `openspec/specs/web-fetch-routing/spec.md` - Adds Mdream and sequential fallback behavior.

### Affected Code

- `open-sse/executors/mdream-fetch.ts` - New Mdream executor.
- `open-sse/executors/parallel-extract.ts` - New Parallel Extract executor.
- `open-sse/handlers/webFetch.ts` - Provider chain, capability routing, fallback decisions.
- `src/app/api/v1/web/fetch/route.ts` - Request validation, credentials, fallback flag wiring.
- `src/shared/validation/schemas.ts` - `v1WebFetchSchema` provider enum and fallback flag.
- `src/shared/constants/providers.ts` - New `parallel` connection entry (`authHint`/`website`) so `PARALLEL_API_KEY` is enterable via the existing Providers UI; Mdream stays keyless.
- `src/app/api/search/providers/route.ts` - Fetch provider catalog includes Mdream and Parallel Extract with capability/status metadata for the search-tools UI.
- `tests/unit/*web-fetch*` and `tests/e2e/search-tools-studio.spec.ts` - Coverage.

### User Impact

- Hermes can use one extraction endpoint with provider fallback.
- Parallel Extract becomes available for fast direct URL extraction before heavier extract/crawl providers.
- Sensitive or private URLs fail before public Mdream receives them.
- Explicit provider calls remain predictable.

### API Changes

- `POST /v1/web/fetch` accepts `provider: "mdream"`.
- `POST /v1/web/fetch` accepts `provider: "parallel-extract"`.
- `POST /v1/web/fetch` accepts optional `fallback: true`.
- Response shape stays `{ provider, url, content, links, metadata, screenshot_url }`.

### Migration Required

- [ ] Database migration
- [ ] API version bump
- [ ] User communication needed
- [x] Documentation updates

## Timeline Estimate

Medium. Two new executors, route/handler refactor, privacy filter, and test coverage.

## Risks

- Public Mdream privacy leak: mitigate with URL classification before executor dispatch.
- Wrong fallback on real page 404: treat confirmed page-level `400` and `404` as terminal unless error classification proves provider failure.
- Capability mismatch: skip Mdream before execution when requested format or fetch options cannot be served by Mdream.
- Parallel Extract API drift: mitigate with isolated request builder/normalizer tests and strict empty-content rejection.
