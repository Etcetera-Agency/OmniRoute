# Design: Additional Search Providers

## Candidate Provider Batches

### Batch 1

```text
parallel-search
firecrawl-search
```

Rationale:
- Parallel is AI-agent-oriented search.
- Firecrawl has search plus extraction in agent pipelines.

Cross-change coordination:
- `parallel-search` (this change) and `parallel-extract`
  (`add-mdream-web-fetch-fallback`) are distinct provider IDs from the same
  vendor (parallel.ai) and share `PARALLEL_API_KEY`. Reuse the credential
  resolution defined by whichever change lands first; do not introduce a
  second key or duplicate connection mapping.
- `firecrawl-search` (this change, search) and `firecrawl`
  (`/v1/web/fetch`, extraction) are intentionally separate provider IDs for the
  same vendor. Keep them distinct; do not merge their registry entries.

## Provider Interface

Every adapter returns:

```text
SearchResponse {
  provider
  query
  results[]
  answer
  usage
  metrics
  errors[]
}
```

Every result includes a valid URL or is dropped.

## Candidate Notes And Free Quota

parallel-search
- What it is: AI-agent search API that returns ranked URLs and compressed excerpts.
- Why useful: Good default for agent retrieval when we want search results already shaped for LLM consumption.
- Free quota: official pricing says users can run up to 16,000 requests for free; paid Search API price is listed as $0.005 per request for 10 results.
- Risk: commercial hosted provider; keep behind explicit credentials.

firecrawl-search
- What it is: Firecrawl Search endpoint plus extraction/crawl ecosystem.
- Why useful: Search can be paired with clean page extraction and JS/browser capabilities later.
- Free quota: official pricing says 1,000 free credits per month; Search costs 2 credits per 10 results.
- Risk: credit math varies by feature; registry metadata must expose credit notes.

## Excluded From This Slice

```text
UniSearch
serpapi-search
jina-search
kagi-search
xai-search
duckduckgo-search
bing-search
searcharvester-search
GitHub code search
academic-only search
social-only search
```

UniSearch is a generative search architecture, not a provider adapter. `serpapi-search` is excluded because it duplicates Google SERP scraper coverage already represented by `serper-search` and `searchapi-search`. `jina-search` is excluded because OmniRoute already has `jina-reader` for fetch and `jina-ai` for model/rerank use; a distinct Jina search endpoint needs separate approval before implementation. `kagi-search`, `xai-search`, `duckduckgo-search`, and `bing-search` are excluded by explicit project decision. `searcharvester-search` is excluded because OmniRoute already supports direct `searxng-search`, and this slice does not need a Tavily-compatible SearXNG wrapper. GitHub/academic/social search need separate `search_type` semantics before joining `/v1/search`.
