# Design — rebalance planning inputs

## Head inventory snapshot (reuse)

```pseudo
function buildInventory(pools):
  tailProviders = readTailConfig().providers          # disjoint set, excluded here
  rows = []
  for conn in getProviderConnections({ isActive: true }):      # providers.ts
    if conn.provider in tailProviders: continue                # SHALL NOT enter head
    for m in getSyncedAvailableModelsForConnection(conn.id):   # models.ts
      caps = modelsDevCapabilities(m) ∪ getModelCompatOverrides(conn.provider, m)
      rows.push({
        providerId: conn.provider, modelId: m, connectionId: conn.id,   # account-level
        capabilities: caps,
        contextWindow: modelsDevContext(m),            # limit_context
        free: freeModelCatalog.lookup(conn.provider, m),
        intelligence: null, quota: null,               # filled by other modules
      })
  return rows
```

## Band resolution (reuse getResolvedTaskFitness)

```pseudo
function bandScore(candidate, band):                   # band = {category,min,max}
  score = getResolvedTaskFitness(candidate.modelId, band.category)   # [0..1] | null
  return score                                         # null => UNRATED (not head on score)

function inBand(candidate, band, delta=0):
  s = bandScore(candidate, band)
  return s != null and (band.min - delta) <= s <= (band.max + delta)
```

## Quota source precedence

```pseudo
function liveQuotaAxes(candidate):
  usage = getUsageForProvider(candidate.connection)
  normalized = normalizeLiveQuota({
    usage,                                  # provider-specific usage.ts shape
    quotaCache: readQuotaCache(candidate.connectionId),
    providerId: candidate.providerId,
    connectionId: candidate.connectionId,
    modelId: candidate.modelId,
  })
  # normalized extracts candidate-scoped axes from quota windows, per-model buckets,
  # remaining/reset fields, and cached 429/reset state.
  return normalized.axes                     # null when no numeric live axis exists

function resolveQuota(candidate):
  live = liveQuotaAxes(candidate)
  if live != null:
    return { axes: live, tier: 1 }           # normalized from usage.ts/cache/reset state
  if candidate.free?.monthlyTokens:
    return { axes: { tokensPerMonth: candidate.free.monthlyTokens }, tier: 2 }
  claim = searchResearchClaim(candidate)               # net-new (relocated FMO), tier 3
  if claim: return { axes: fromClaim(claim), tier: 3 }
  return { axes: null, tier: 4 }                        # no number -> canary (solve slice)
```

## Search-research relocation (internal only)

`searchResearchClaim(candidate)` is a relocated FMO quota research step, but it
SHALL live inside OmniRoute as a server-side library helper. It SHALL NOT call
`POST /api/v1/search`, construct a `Request`, call `fetch` back into OmniRoute, or
depend on the app route boundary. The app route may keep using the shared search
chain, but quota research must call the same internal chain directly.

```pseudo
function searchResearchClaim(candidate):
  query = buildQuotaQuery(candidate.providerId, candidate.modelId, today())

  snapshot = runQuotaSearch(query)            # normalized OmniRoute SearchResponse
  if snapshot == null:
    return null

  claim = extractQuotaClaimWithInternalLlm({
    prompt: loadQuotaResearchPrompt(),        # FMO quota-research prompt text/rules
    schema: QuotaClaimResponseSchema,
    provider: candidate.providerId,
    provider_model_id: candidate.modelId,
    source_type: "search_summary",
    source_url: snapshot.primaryUrl ?? query,
    previous_limit: candidate.previousLimit ?? "unknown",
    text: snapshot.answerText ?? snapshot.resultSnippets.join("\n"),
    evidenceUrls: snapshot.evidenceUrls,
  })

  if claim == null:
    return null

  return {
    axes: fromClaim(claim),
    source: "search-research",
    searchSnapshot: snapshot,                 # consumed by planning state/evidence
  }

function runQuotaSearch(query):
  body = {
    query,
    provider: "gemini-grounded-search",
    search_type: "web",
    max_results: 10,
    time_range: "month",
  }

  result = runInternalSearchChain(body)       # buildSearchAttempts + runSearchChain
  if result.status == 429:
    body.provider = null                      # provider unset => chain auto-routing order
    result = runInternalSearchChain(body)     # configured search-provider priority, not one fixed provider
  return summarizeSearchResult(result)
```

`summarizeSearchResult` SHALL consume OmniRoute's normalized `SearchResponse`:
`answer.text` is the primary quota summary, `results[*].snippet` is fallback text,
and `results[*].url` becomes evidence. The snapshot SHALL carry at least `query`,
`provider`, `answerText`, `resultSnippets`, `evidenceUrls`, `retrievedAt`, and a
stable `contentHash`, and SHALL be attached to the tier-3 quota result so the
planning/debug surface can explain where the number came from. Search results SHALL
NOT be dropped after extraction.

No separate FMO/Instructor inspector SHALL be introduced in OmniRoute. The FMO
`quota-research` prompt/rules were the correct contract and SHALL be preserved:
use supplied text only, never guess, require evidence for every limit, prefer
cumulative daily/monthly free-tier axes over RPM/TPM when present, use
`previousLimit` to choose within ranges, and reject unusable claims. OmniRoute
SHALL apply that contract through its own internal LLM/chat pipeline with structured
JSON output, not through the FMO Python client, the FMO Instructor runtime, or an
OmniRoute HTTP route call. The LLM extraction input SHALL be the normalized search
snapshot text/evidence, and the output SHALL be validated as `QuotaClaimResponse`
before it is trusted.

```pseudo
function extractQuotaClaimWithInternalLlm(input):
  body = {
    model: selectOmniRouteInternalExtractorModel("quota-research"),
    messages: [
      { role: "system", content: input.prompt.system },
      { role: "user", content: renderQuotaResearchInput(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: QuotaClaimResponseSchema,
    },
    temperature: 0,
  }

  response = runInternalChatPipeline(body)    # shared OmniRoute LLM stack, no /api route
  claim = parseJson(response.content)
  return validateQuotaClaimResponse(claim, input.text, input.evidenceUrls)
```

`renderQuotaResearchInput` SHALL pass the same variables the FMO prompt expects:
`provider`, `provider_model_id`, `source_type`, `source_url`, `text`, and
`previous_limit`. The prompt text may be stored in OmniRoute, but it must preserve
the FMO `quota-research` contract.

### Reuse vs net-new for the extractor (implementation note)

This extractor has **no ready-made one-off helper in OmniRoute** — it is net-new
wiring over existing primitives, not a call to an existing `extractStructured()`:

- `runInternalSearchChain` / `summarizeSearchResult` — **reuse**: the internal search
  chain (`buildSearchAttempts` + `runSearchChain` in `src/lib/search/searchChain.ts`,
  over `handleSearch`) and its normalized `SearchResponse` (`answer.text`, `results`)
  already exist. `gemini-grounded-search` is a registered provider in
  `open-sse/config/searchRegistry.ts`.
- `runInternalChatPipeline` — **net-new wiring around `handleChatCore`**. There is no
  existing in-process "ask the LLM once and get JSON" helper; every current
  `handleChatCore` caller (`open-sse/services/combo.ts`,
  `open-sse/services/autoCombo/pipelineRouter.ts`, `src/sse/handlers/chatHelpers.ts`)
  invokes it while serving a live request with `body`/`modelInfo`/`credentials`
  already assembled. The extractor must do that assembly itself:
  resolve the extractor model via `getModelInfo`, resolve credentials via
  `getProviderCredentials`, build an OpenAI-shaped `body` (with the `response_format`
  JSON-schema below), call `handleChatCore`, then collect and parse the response.
  `response_format` is honored through the translators (e.g.
  `open-sse/translator/request/openai-to-claude.ts`,
  `.../openai-to-gemini.ts`), so no provider-native JSON mode is assumed.
- `validateQuotaClaimResponse` — **net-new**: re-implements the FMO deterministic
  validation (evidence required, cumulative-over-RPM, range-by-`previousLimit`,
  reject-unusable) in OmniRoute; the FMO Instructor runtime is **not** reused.

The quota search query SHALL preserve FMO wording:

```pseudo
if modelId == "*":
  query = "Free-tier quota topology and limits for provider {provider}, current as of {YYYY-MM-DD}. " +
          "Say if quota is provider/account-wide, model-group/per-model, or RPM-only. " +
          "Include cumulative requests/day or month, tokens/day or month, requests/minute if no cumulative quota, hard stop, URLs."
else:
  providerHint = "" if provider startsWith "openai-compatible-" or len(provider) > 48
                 else " on provider {provider}"
  query = "Free-tier quota for model {modelId}{providerHint}, current as of {YYYY-MM-DD}. " +
          "Find cumulative requests/day, requests/month, tokens/day, tokens/month, " +
          "whether quota is hard stop or throttle, and source URLs. Ignore RPM/TPM."
```

## Request-equivalents capacity

```pseudo
function capacityReqPerDay(axes, pool):
  if axes == null: return null                          # tier 4, not counted
  w = max(classWeight(pool.workload_class), GLOBAL.tokensPerRequest)
  byTokens = axes.tokensPerMonth ? (axes.tokensPerMonth / w / 30) : +inf
  byRate   = axes.rpd ?? (axes.rpm ? axes.rpm*60*24*RATE_DISCOUNT : +inf)
  return min(byTokens, byRate)                          # tightest axis

# tokens_per_request learning loop (net-new), recalibrated, clamped, seed=2000:
#   GLOBAL.tokensPerRequest = clamp(avg(observed_tokens / observed_requests))
```
