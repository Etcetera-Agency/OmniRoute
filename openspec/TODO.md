# OpenSpec TODO

Deferred scope discovered while preparing the Hermes OmniRoute specs.

## Deferred Items

0. Keep FMO pool extractor live-provider coverage pending until an internal
   extractor model is configured for this fork.
1. Wire the FMO rebalance scheduler to the production materialized-plan builder
   once the Hermes-side pool solver publishes accepted plans into OmniRoute. The
   apply seam now requires a validated plan whose generation matches the accepted
   pool marker; scheduled runs are self-gated and non-fatal, but they must not
   synthesize empty combos from stored pool specs.
2. Before implementing `add-fmo-pools-planning` search-research tier, pin the
   relocated quota search contract to OmniRoute's internal search chain:
   `searchResearchClaim(candidate)` must call `buildSearchAttempts`/`runSearchChain`
   or the equivalent shared server-side helper directly, never `POST /api/v1/search`,
   `fetch`, `Request`, `Response`, or the app route boundary. First try
   `provider="gemini-grounded-search"`, fall back to default internal search on 429
   only, preserve the FMO quota query wording, consume OmniRoute's normalized
   `SearchResponse.answer.text`/`results` directly, keep a search snapshot/evidence
   on the tier-3 quota result, then process that snapshot through OmniRoute's own
   internal LLM/chat pipeline with structured JSON output. Preserve the existing
   FMO `quota-research` prompt/rules as the canonical extraction contract, pass
   `provider`, `provider_model_id`, `source_type`, `source_url`, `text`, and
   `previous_limit`, validate the returned `QuotaClaimResponse`, and do not add a
   separate FMO/Instructor inspector.
   Implementation note: planning slice now has the in-process search-chain seam,
   evidence snapshot, and claim validator. Add live internal-LLM extractor
   contract coverage once an extractor model is configured for this fork.

3. Keep the daily model-manager routine in the Hermes repo. OmniRoute only supplies management APIs, routing behavior, telemetry, and provider support consumed by that routine.
4. Prepare an upstream OmniRoute PR after the fork changes stabilize:
   - Mdream web-fetch executor.
   - Extensible web-fetch provider registry.
   - Configurable fetch provider priority.
   - Sequential web-fetch fallback.
   - Cooldown and circuit-breaker integration.
5. Keep Hermes browser fallback out of first version. Firecrawl remains the final provider for JavaScript rendering, screenshots, selector waiting, and deeper crawl options.
6. `gemini-grounded-search` is now tracked as its own OpenSpec change. Keep it separate from generic search provider ordering.
7. Additional provider candidates are tracked in `add-additional-search-providers`; implement in batches, not all at once.
8. Mdream live endpoint check on 2026-06-15 showed `https://mdream.dev/p/<url>` returns the Nuxt UI shell, while `https://mdream.dev/<host/path?query>` returns raw markdown. Keep the executor on the verified raw endpoint unless Mdream publishes a stable raw API that preserves URL scheme.
9. `mcp-omnisearch` review on 2026-06-15 found reusable MIT-licensed patterns worth adapting later: provider registration with missing-key status entries, compound `provider:mode` IDs for extract modes, schema-validated provider responses, shared retryable error classification, and configurable Firecrawl v2 base URL. Do not copy its implementation wholesale; port only logic that fits OmniRoute contracts.
10. Verify Mdream and Parallel Extract rendering in `/dashboard/search-tools` after the provider UI supports the shared `parallel` connection. API catalog integration is covered now; visual dashboard verification remains deferred.
11. Fix existing docs i18n CHANGELOG drift that makes the pre-commit `docs-sync` hook fail on many `docs/i18n/*/CHANGELOG.md` files. This is unrelated to OmniRoute search slices, but it blocks verified commits unless bypassed.
12. Fix existing MDX frontmatter in `docs/security/SUPPLY_CHAIN.md`: `npx playwright test tests/e2e/search-tools-studio.spec.ts` cannot start its webServer because Fumadocs rejects the document with `title: Invalid input: expected string, received undefined`. This blocks dashboard E2E verification for routing UI until the docs source is corrected.
