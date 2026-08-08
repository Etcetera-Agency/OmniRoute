## 1. Write failing contract tests first (TDD red phase)

- [x] 1.1 Add search-chain quota fixtures that seed a preflight-exhausted primary
      connection and a usable ordered fallback; assert the primary is not fetched, the fallback is
      fetched, and the response/provider telemetry identify the fallback.
- [x] 1.2 Add explicit-search quota coverage; assert an exhausted explicit provider returns the
      existing rate-limited status and `Retry-After` metadata without trying any other provider.
- [x] 1.3 Add all-candidates-exhausted search coverage; assert the first blocked candidate's
      rate-limited descriptor is returned instead of a misleading missing-credentials 400.
- [x] 1.4 Extend `tests/unit/search-additional-providers.test.ts` with alias request/normalization
      cases: shared helper path, alias-only body options, timeout/quota metadata, URL filtering,
      `firecrawl-search` citation, and unchanged canonical `firecrawl` behavior. Assert both IDs
      remain accepted by the registry/schema/catalog.
- [x] 1.5 Add `tests/unit/9201-search-proxy-bypass.test.ts` (or the fork-equivalent proxy test)
      with a local proxy and primary/fallback connections; assert each request uses its own proxy and
      sanitized events omit query strings, API keys, and proxy credentials.
- [x] 1.6 Extend `tests/unit/web-fetch-quota-fallback.test.ts` with preflight-blocked primary,
      explicit-provider, request-time 429, quota-style 402/403, non-quota 400, and whole-pool
      exhausted cases while preserving mdream/parallel/order assertions.
- [x] 1.7 Extend `tests/unit/executor-firecrawl-fetch.test.ts` with direct credential
      `baseUrl`, nested `providerSpecificData.baseUrl`, environment precedence, trailing-slash
      normalization, self-hosted no-key, and default-cloud key-required cases.
- [x] 1.8 Add workflow tests for self-target PR rejection, generated agent-skill sync membership,
      pinned action/scanner refs, base-relative ratchets, npm same-repository artifact filtering and
      install-upgrade guard, Docker version resolution, Electron asset verification, and intentional
      no-schedule/fork-image preservation. Confirm these tests fail on the pre-change tree.

## 2. Implement quota-aware routing slices (TDD green phase)

- [x] 2.1 Replace direct search credential reads in `src/lib/search/searchChain.ts` with
      `getProviderCredentialsWithQuotaPreflight`, preserving Hermes overlay order, credential
      fallback IDs, rate-limited descriptors, explicit-provider errors, and fallback-only providers.
- [x] 2.2 Thread the authenticated API-key policy ID and each selected connection ID through the
      search route/attempt shape without changing request or response schemas.
- [x] 2.3 Resolve web-fetch credentials through quota preflight in
      `src/lib/webfetch/webFetchCredentials.ts`; preserve keyless mdream, Parallel credential
      mapping, configured order, capability filtering, cooldowns, and fallback flags.
- [x] 2.4 Update `open-sse/handlers/webFetchChain.ts` to skip preflight-blocked candidates,
      classify provider-specific quota statuses, return one exhausted-pool 429 with retry metadata,
      and retain explicit-provider no-fallback behavior unless `fallback: true`.
- [x] 2.5 Run the focused search and web-fetch tests from section 1 and keep the tests in the
      package checked only after they pass.

## 3. Implement shared Firecrawl and search transport slices

- [x] 3.1 Parameterize `open-sse/handlers/search/firecrawlSearch.ts` with a provider variant and
      route both `firecrawl` and `firecrawl-search` through it; remove the duplicate alias builder
      and normalizer from `open-sse/handlers/search.ts` without removing either provider ID.
- [x] 3.2 Preserve alias-only `ignoreInvalidURLs`/scrape options, timeout, quota metadata,
      valid-URL filtering, lower/upper-case request normalization, and citation provider while
      leaving native Firecrawl defaults unchanged.
- [x] 3.3 Add `open-sse/handlers/search/searchProxy.ts`; resolve per-attempt proxy using
      connection/API-key/provider precedence, wrap fetch in proxy context, include connection ID in
      call logs, and emit sanitized proxy events with fail-open resolution/logging.
- [x] 3.4 Wire primary and alternate search attempts to the proxy boundary and run proxy,
      normalization, and route regression tests.

## 4. Implement Firecrawl fetch credential-base support

- [x] 4.1 Update `open-sse/executors/firecrawl-fetch.ts` to resolve
      `FIRECRAWL_BASE_URL` → credential `baseUrl` → `providerSpecificData.baseUrl` → cloud default,
      normalizing trailing slashes.
- [x] 4.2 Make API-key enforcement conditional on the resolved base: require a key for the
      public cloud endpoint, allow self-hosted/custom endpoints without a key, and omit the
      `Authorization` header when no key is present.
- [x] 4.3 Run the Firecrawl executor and web-fetch handler tests, including timeout and sanitized
      error assertions.

## 5. Port selective workflow hardening without fork workflow loss

- [x] 5.1 Add the self-target PR guard and generated agent-skill synchronization check to the
      appropriate CI jobs, with unit coverage and env-only input handling.
- [x] 5.2 Pin action refs, CodeQL, zizmor, and scanner versions; update workflow checks to print
      the effective versions and ratchet findings deterministically.
- [x] 5.3 Make quality file-size/ratchet checks base-relative for PRs and absolute for manual
      dispatch, preserving the existing baseline files and gate membership.
- [x] 5.4 Port Electron per-architecture artifact collection/manifest merge and a separate
      release asset-presence verifier that checks every platform without blocking npm publication.
- [x] 5.5 Harden npm publication artifact reuse to same-repository CI runs, retry retained
      artifacts by presence, and run clean-install plus upgrade-over-previous boot checks before
      staging/publishing.
- [x] 5.6 Port env-safe Docker release-version resolution while preserving GHCR/DockerHub image
      names, fork image workflows, mutable channels, and existing publication triggers.
- [x] 5.7 Add/adjust workflow tests to prove no intentional nightly schedule is reintroduced and
      no fork image workflow is deleted or retargeted.

## 6. Verification and handoff

- [x] 6.1 Run focused Node native tests for search quota/alias/proxy, web-fetch quota, Firecrawl
      credentials, and workflow guards; then run the affected integration tests.
- [x] 6.2 Run `actionlint`, `zizmor`, repository workflow checks, and the release/workflow unit
      suite with pinned tool versions.
- [x] 6.3 Run `openspec validate update-upstream-routing-hardening --strict` and resolve every
      validation error.
- [x] 6.4 Run Code Simplifier on the implemented slices, record any surviving follow-up scope in
      `openspec/TODO.md`, and leave the package ready for implementation/archive review.
