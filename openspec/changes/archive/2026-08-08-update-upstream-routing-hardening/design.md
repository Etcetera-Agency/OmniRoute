# Design: one upstream-hardening seam around fork-owned routing

## Context

Hermes owns the provider overlay and the configured order in
`src/lib/search/providerRegistry.ts`, plus `mdream` and `parallel-extract` in the web-fetch
chain. Upstream owns the credential/quota services, native Firecrawl search helper, proxy
context utilities, and release-quality checks. The integration must therefore copy behavior at
the boundaries, not replace the fork registries or move fork policy into upstream files.

The implementation is one change with six ordered slices. Each slice starts with a failing
contract test, then changes the smallest boundary module, then runs its focused test set. The
final slice runs workflow/static validation. No slice introduces a compatibility shim for a
removed API: existing Hermes IDs remain first-class IDs until a separately approved
canonicalization change.

## Goals and invariants

- **Quota invariant:** no provider request is sent after its selected connection is rejected by
  quota preflight. A preflight-blocked connection is represented using the existing
  `allRateLimited`/`RateLimitedCredentials` contract and carries retry metadata.
- **Routing invariant:** automatic search continues to use the merged Hermes overlay order;
  explicit search remains single-provider. Automatic web fetch continues to use effective
  configured order, capability filtering, cooldowns, and retry/fallback flags.
- **Alias invariant:** `firecrawl` and `firecrawl-search` remain accepted IDs in registries,
  schemas, catalogs, tests, and citations. The native helper is shared, but each ID retains its
  current quota, timeout, URL filtering, body options, and citation provider.
- **Proxy invariant:** each search attempt resolves proxy context from its own connection/API-key
  pair. A fallback attempt can never inherit the primary connection's proxy. Proxy resolution
  failure is fail-open to direct transport, matching upstream behavior.
- **Credential invariant:** Firecrawl base URL resolution is deterministic: environment override,
  direct credential `baseUrl`, credential `providerSpecificData.baseUrl`, then public cloud
  default. A custom base omits `Authorization` when no key exists; public cloud without a key
  returns the existing 401 error.
- **Workflow invariant:** hardening is additive and pinned. Existing fork image names/triggers
  remain, and the intentional absence of schedules in manual/continuous fork workflows remains.

## Decisions

### 1. Quota-aware search credential adapter

`src/lib/search/searchChain.ts` will call
`getProviderCredentialsWithQuotaPreflight(providerId)` for every candidate, including a
credential fallback ID (`parallel-search → parallel`, `firecrawl-search → firecrawl`, and the
existing upstream map). The adapter preserves the first rate-limited result while continuing to
look for a usable credential. It returns a normal credential object, `null`, or the original
rate-limited descriptor; callers do not inspect quota internals.

The route keeps the current response policy:

- explicit provider + preflight block → `rateLimitedProviderResponse` for that provider, no
  other provider attempt;
- automatic provider + preflight block → skip that provider and continue the configured chain;
- every automatic candidate blocked → return the first blocked provider's rate-limited response;
- no credential and no blocked candidate → preserve the current 400 configuration error.

The credential object returned by preflight carries `connectionId`. The search route also passes
the authenticated API-key policy ID to the chain so proxy resolution can apply per-key rules.

Pseudocode:

```text
resolveSearchCandidate(providerId):
  firstBlocked = null
  for credentialProviderId in [providerId, fallbackId(providerId)]:
    credentials = getProviderCredentialsWithQuotaPreflight(credentialProviderId)
    if credentials is usable:
      return usable(credentials)
    if credentials is allRateLimited and firstBlocked is null:
      firstBlocked = credentials
  if firstBlocked exists:
    return blocked(firstBlocked)
  return missing

buildSearchAttempts(request):
  ids = request.provider ? [request.provider] : effectiveOverlayOrder(request.search_type)
  firstBlocked = null
  for id in ids:
    candidate = resolveSearchCandidate(id)
    if candidate.blocked:
      firstBlocked ??= candidate
      continue
    if candidate.missing:
      if request.provider: return explicitMissingError(id)
      continue
    attempts.push({ config: overlayConfig(id), credentials: candidate.credentials })
  if attempts is empty and firstBlocked exists: return rateLimited(firstBlocked)
  if attempts is empty: return noProviderError()
  return attempts
```

### 2. Shared native Firecrawl search helper with an alias variant

`open-sse/handlers/search/firecrawlSearch.ts` remains the only request builder and normalizer.
It receives a small variant object rather than branching into a second implementation in
`open-sse/handlers/search.ts`:

```text
variant = {
  providerId,
  timeoutMs: config.timeoutMs,
  freeMonthlyQuota: config.freeMonthlyQuota,
  invalidUrlPolicy: providerId == "firecrawl-search" ? "drop" : "preserve",
  citationProvider: providerId,
  aliasBody: providerId == "firecrawl-search"
    ? { ignoreInvalidURLs: true, scrapeOptionsFromContent: true }
    : {}
}
request = buildFirecrawlSearchRequest(config, params, variant)
normalized = normalizeFirecrawlSearchResponse(envelope, searchType, makeResult, variant)
```

The canonical native request keeps its upstream v2 defaults. The alias variant keeps the fork
contract: the alias-only invalid-URL drop, content/scrape options, configured 60-second timeout,
500-credit quota metadata, and `firecrawl-search` citation ID. Domain filters are normalized
before serialization; only the selected `data.web` or `data.news` bucket is read. Both IDs still
flow through the overlay registry and validation/catalog surfaces.

The helper also accepts the existing Firecrawl base override inputs, so an environment or
provider-specific base is not reimplemented by the alias path. The separate fetch executor
uses the same precedence for credentials (Decision 5).

### 3. Search proxy/security boundary

Add `open-sse/handlers/search/searchProxy.ts` as the per-attempt transport chokepoint. The
handler builds a provider request, then:

1. calls `resolveProxyForConnection(connectionId, apiKeyId, providerId)`;
2. wraps the actual `fetch` in `runWithProxyContext` when a proxy exists;
3. records the connection ID in the call log;
4. emits a sanitized proxy event with provider, connection ID, proxy level, status, duration,
   target origin/path, and no URL query, search text, API key, username, or password.

The primary and alternate attempts each pass their own credential `connectionId`. Missing IDs
use direct transport. Resolver/import/logging failures do not fail the search response.

Pseudocode:

```text
executeProviderAttempt(config, request, credentials, apiKeyId):
  binding = resolveSearchProxy(credentials.connectionId, apiKeyId, config.id)
  response = fetchWithSearchProxy(binding.proxy, () => fetch(request))
  saveCallLog({ provider: config.id, connectionId: credentials.connectionId, ...status })
  emitSanitizedProxyEvent(origin(request.url), pathname(request.url), binding, status)
  return normalizeOrRetry(response)
```

### 4. Web-fetch preflight and status policy

`src/lib/webfetch/webFetchCredentials.ts` resolves credentials with the quota-aware auth
function. `parallel-extract` still resolves through its `parallel-search` connection and
`PARALLEL_API_KEY`; `mdream` remains keyless. The resolver returns a plan that distinguishes a
usable credential, a rate-limited descriptor, and missing credentials.

`open-sse/handlers/webFetchChain.ts` keeps the fork order and capability filter. Automatic mode
skips preflight-blocked candidates and retries request-time quota statuses. `429` is retryable
for every provider; `402`/`403` are retryable only for providers whose registry marks quota
statuses (including Firecrawl), so a normal bad request does not trigger an unrelated provider.
Explicit mode returns the provider's rate-limited response without fallback unless the request's
existing `fallback: true` flag explicitly opts into the configured remainder. If every automatic
candidate is blocked or returns quota exhaustion, return one 429 with `Retry-After`.

Pseudocode:

```text
resolveWebFetchTarget(request):
  ids = explicit
    ? (request.fallback ? [explicit, ...effectiveForkOrderAfter(explicit)] : [explicit])
    : effectiveForkOrder()
  for id in ids:
    credentials = preflightCredentials(mappedCredentialProvider(id))
    if credentials is usable: return target(id, credentials)
    if credentials is blocked: rememberFirstBlocked(); continue
    if explicit and !request.fallback: return missingCredential400(id)
  if firstBlocked exists: return rateLimited429(firstBlocked)
  return noCredentials400()

runWebFetch(target, request):
  for provider in compatibleProviders(target, request):
    result = execute(provider)
    if success: return result
    if explicit and !request.fallback: return result
    if retryableStatus(provider, result.status) or emptyContent: continue
    return result
  return rateLimited429WithRetryAfter()
```

### 5. Firecrawl per-credential base URL and self-hosted auth

`open-sse/executors/firecrawl-fetch.ts` receives the complete credential object. The resolver
normalizes one trailing path boundary and applies this exact precedence:

```text
resolveFirecrawlBase(credentials):
  env = trim(FIRECRAWL_BASE_URL)
  direct = trim(credentials.baseUrl)
  nested = trim(credentials.providerSpecificData.baseUrl)
  return firstNonEmpty(env, direct, nested, "https://api.firecrawl.dev")
```

The public cloud base requires `credentials.apiKey`. A custom base allows an empty key and does
not send an `Authorization` header; when a key is present it is still sent. Existing timeout,
format, metadata, and error sanitization behavior remains unchanged.

### 6. Selective workflow hardening

Port only the release guardrails that are independent of fork image ownership:

- CI runs the self-target PR guard before expensive jobs and runs generated agent-skill sync;
- action refs and CodeQL/zizmor/scanner versions are pinned and reported by workflow checks;
- quality file-size ratchet uses `--base-ref` on pull requests (absolute mode on dispatch);
- Electron release merges per-architecture manifests and has a separate asset-presence verifier;
- npm artifact reuse filters to same-repository CI runs, tries retained artifacts by presence, and
  runs both clean-install and upgrade-over-previous boot checks before staged publish;
- Docker release metadata comes from the env-safe version resolver while existing GHCR,
  DockerHub, fork image names, and mutable channels remain intact;
- actionlint, zizmor, and workflow unit tests run as blocking verification.

The workflow tests assert that the intentional no-schedule topology remains (in particular the
manual `Nightly Node Compat` workflow and the fork's `Release-Green (continuous)` workflow).
No upstream nightly trigger is copied as part of this change.

## Failure handling and observability

- Quota preflight errors are fail-open only when the upstream preflight service itself cannot
  produce a signal; an explicit exhausted signal always blocks the connection.
- Provider request errors continue through existing retry/fallback classification and sanitized
  error helpers. No raw upstream response body, stack, token, or full secret-bearing URL is
  added to logs.
- Proxy logging is best-effort and cannot change the HTTP result.
- Workflow artifact verification fails its own job after release assets are attached; it does not
  suppress an otherwise independent npm channel.

## Migration and rollback

No database migration is needed. Deploy in the six slices described in `tasks.md`; each slice
is independently revertible by restoring its adapter and tests. Existing provider connection
rows continue to work because `baseUrl` and `providerSpecificData.baseUrl` are optional. A
self-hosted Firecrawl row with no key becomes usable only after the new resolver is deployed;
cloud rows retain the current key requirement.

## Verification gates

Run focused Node tests for each slice, then the search/web-fetch integration tests, workflow unit
tests, `actionlint`, `zizmor`, and `openspec validate update-upstream-routing-hardening --strict`.
The implementation is not complete until all tasks are checked and the deliberate schedule and
fork image assertions pass.
