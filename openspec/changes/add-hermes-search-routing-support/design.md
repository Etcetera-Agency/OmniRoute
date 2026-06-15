# Design: Hermes Search Routing Support

## Provider Order

Default configured order:

```text
brave-search
tavily-search
exa-search
serper-search
searchapi-search
linkup-search
searxng-search
youcom-search
perplexity-search
```

The order uses providers already present in `open-sse/config/searchRegistry.ts`.
Explicit `provider` requests remain single-provider requests. Search routing
fallback is only used when `provider` is omitted.

## Runtime Selection

Pseudocode:

```text
selectSearchChain(request):
  if request.provider exists:
    return [request.provider]

  providers = configuredOrder.filter(supports request.search_type)
  providers = providers.filter(hasCredentialsOrNoAuth)
  providers = providers.filter(notInCooldownUnlessProbeAllowed)
  return providers
```

## Fallback Execution

Pseudocode:

```text
for provider in selectSearchChain(request):
  result = executeSearch(provider, request)
  if result.success and result.results has valid URL:
    return result
  if result is terminal client error:
    return result
  record fallback reason

return aggregated failure with attempt summaries
```

Retry next provider for:

```text
408
429
500..599
timeout
network error
credential unhealthy
provider cooldown
quota exhausted
empty result set when provider reported success without usable URLs
```
