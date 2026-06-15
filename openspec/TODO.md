# OpenSpec TODO

Deferred scope discovered while preparing the Hermes OmniRoute specs.

## Deferred Items

1. Keep the daily model-manager routine in the Hermes repo. OmniRoute only supplies management APIs, routing behavior, telemetry, and provider support consumed by that routine.
2. Prepare an upstream OmniRoute PR after the fork changes stabilize:
   - Mdream web-fetch executor.
   - Extensible web-fetch provider registry.
   - Configurable fetch provider priority.
   - Sequential web-fetch fallback.
   - Cooldown and circuit-breaker integration.
3. Keep Hermes browser fallback out of first version. Firecrawl remains the final provider for JavaScript rendering, screenshots, selector waiting, and deeper crawl options.
4. `gemini-grounded-search` is now tracked as its own OpenSpec change. Keep it separate from generic search provider ordering.
5. Additional provider candidates are tracked in `add-additional-search-providers`; implement in batches, not all at once.
6. Mdream live endpoint check on 2026-06-15 showed `https://mdream.dev/p/<url>` returns the Nuxt UI shell, while `https://mdream.dev/<host/path?query>` returns raw markdown. Keep the executor on the verified raw endpoint unless Mdream publishes a stable raw API that preserves URL scheme.
7. `mcp-omnisearch` review on 2026-06-15 found reusable MIT-licensed patterns worth adapting later: provider registration with missing-key status entries, compound `provider:mode` IDs for extract modes, schema-validated provider responses, shared retryable error classification, and configurable Firecrawl v2 base URL. Do not copy its implementation wholesale; port only logic that fits OmniRoute contracts.
8. Add a `parallel` connection entry to `src/shared/constants/providers.ts` (name, website, auth hint) so `PARALLEL_API_KEY` can be entered through the existing `/dashboard/providers` UI. `parallel-extract` already resolves credentials through the `parallel` provider id and environment fallback.
9. Verify Mdream and Parallel Extract rendering in `/dashboard/search-tools` after the provider UI supports the shared `parallel` connection. API catalog integration is covered now; visual dashboard verification remains deferred.
