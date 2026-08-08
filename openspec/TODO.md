# OpenSpec TODO

Deferred scope discovered while preparing the Hermes OmniRoute specs.

## Deferred Items

- Active FMO pool migration slices from the 2026-07-01 concept audit:
  `fix-fmo-pools-live-seam` is implemented with focused unit coverage and a documented
  deploy smoke in `docs/fmo-pools-live-seam-smoke.md`; production cutover validation
  still must run that smoke through the live bridge before marking the broader pool
  migration complete. `fix-fmo-pools-solver-contract` is implemented with focused unit
  coverage for canonical quality categories, symmetric band relax, runtime/manual
  `customModels` inventory, and hidden-model visibility gates. Do not mark the pool
  migration complete until live cutover smoke passes.

0. Keep FMO pool extractor live-provider coverage pending until an internal
   extractor model is configured for this fork. Unit coverage now verifies the
   in-process `handleChatCore` contract, parser, disable path, and tier-4
   snapshot retention.
1. Keep `add-fmo-pools-planning` live extractor validation pending until this fork
   has a configured, cheap, JSON-reliable quota extractor model. The server-side
   search chain, snapshot/evidence retention, in-process `handleChatCore` extractor,
   parser, and deterministic validator are implemented; remaining work is live
   provider coverage only.

2. Keep the daily model-manager routine in the Hermes repo. OmniRoute only supplies management APIs, routing behavior, telemetry, and provider support consumed by that routine.
3. Prepare an upstream OmniRoute PR after the fork changes stabilize:
   - Mdream web-fetch executor.
   - Extensible web-fetch provider registry.
   - Configurable fetch provider priority.
   - Sequential web-fetch fallback.
   - Cooldown and circuit-breaker integration.
4. Keep Hermes browser fallback out of first version. Firecrawl remains the final provider for JavaScript rendering, screenshots, selector waiting, and deeper crawl options.
5. `gemini-grounded-search` is now tracked as its own OpenSpec change. Keep it separate from generic search provider ordering.
6. Additional provider candidates are tracked in `add-additional-search-providers`; implement in batches, not all at once.
7. Mdream live endpoint check on 2026-06-15 showed `https://mdream.dev/p/<url>` returns the Nuxt UI shell, while `https://mdream.dev/<host/path?query>` returns raw markdown. Keep the executor on the verified raw endpoint unless Mdream publishes a stable raw API that preserves URL scheme.
8. `mcp-omnisearch` review on 2026-06-15 found reusable MIT-licensed patterns worth adapting later: provider registration with missing-key status entries, compound `provider:mode` IDs for extract modes, schema-validated provider responses, shared retryable error classification, and configurable Firecrawl v2 base URL. Do not copy its implementation wholesale; port only logic that fits OmniRoute contracts.
9. Verify Mdream and Parallel Extract rendering in `/dashboard/search-tools` after the provider UI supports the shared `parallel` connection. API catalog integration is covered now; visual dashboard verification remains deferred.
10. Fix existing MDX frontmatter in `docs/security/SUPPLY_CHAIN.md`: `npx playwright test tests/e2e/search-tools-studio.spec.ts` cannot start its webServer because Fumadocs rejects the document with `title: Invalid input: expected string, received undefined`. This blocks dashboard E2E verification for routing UI until the docs source is corrected.
11. Reuse upstream `main` search quota preflight in the fork-owned ordered chain.
    `src/lib/search/searchChain.ts` currently calls `getProviderCredentials` directly,
    while upstream `src/app/api/v1/search/route.ts` uses
    `getProviderCredentialsWithQuotaPreflight`. Adapt the preflight and rate-limited
    response semantics without removing Hermes provider order, aliases, or fallback.
    Add primary/fallback quota-blocked regression coverage.
12. Reuse upstream `main` native Firecrawl search request/normalization helpers for
    the fork `firecrawl-search` alias. Parameterize the alias-only body options,
    timeout, quota, URL filtering, and citation behavior instead of maintaining a
    second builder/normalizer in `open-sse/handlers/search.ts`. Keep both provider IDs
    until an explicit canonicalization change updates schemas, catalogs, and tests.
13. Reuse upstream `main` web-fetch quota preflight/status handling inside the
    fork resolver/chain. Preserve `mdream`, `parallel-extract`, configured ordering,
    fallback flags, cooldowns, and retries. Extend
    `tests/unit/web-fetch-quota-fallback.test.ts` with quota-preflight cases.
14. Port the release-only search proxy/security path after the `main` sync:
    `open-sse/handlers/search/searchProxy.ts` and its proxy-bypass regression test.
    Thread connection/API-key policy IDs through the Hermes search chain so provider
    fetches cannot bypass assigned proxies or policy. Do not replace fork registries.
15. Port release-only Firecrawl fetch credential-base support: retain the existing
    `FIRECRAWL_BASE_URL` behavior from `main`, then add canonical per-credential
    `baseUrl`/`providerSpecificData.baseUrl` resolution and self-hosted no-key tests.
16. Selectively port release-only workflow hardening: self-target PR and agent-skill
    checks, pinned zizmor/CodeQL/actions, base-relative quality ratchets, Electron
    artifact verification, npm supply-chain/install-upgrade guards, and Docker version
    resolution. Preserve fork GHCR/DockerHub/image workflows and intentional removal
    of nightly schedules; validate with actionlint/zizmor and workflow tests.
