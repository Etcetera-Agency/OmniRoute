# Proposal: Add Additional Search Providers

## Why

OmniRoute already supports several general-purpose search providers, but Hermes research workflows benefit from a broader fallback pool across AI-native search and extraction-backed search. Provider expansion should be incremental and adapter-based, not hardcoded into Hermes.

**Context**:
- Current OmniRoute search registry includes providers such as Brave, Tavily, Exa, Serper, Perplexity Search, Google PSE, Linkup, SearchAPI, You.com, SearXNG, Ollama Search, and Z.AI.
- Public multi-provider search tools commonly include additional providers such as Parallel and Firecrawl Search.
- SearXNG is already supported as `searxng-search`, so additional SearXNG wrapper providers are not part of this slice.
- Jina is already represented in OmniRoute as `jina-reader` for web fetch and `jina-ai` for embeddings/rerank, so it is not part of this search-provider expansion unless a separate official Jina search API is explicitly approved later.
- UniSearch is a generative search architecture/paper, not an API provider directly usable by OmniRoute.

**Current state**: OmniRoute has a useful base set, but lacks several practical adapters that appear in other agent-oriented search stacks.

**Desired state**: OmniRoute can register and use additional search providers behind the same `/v1/search` response contract, with capability flags and credential handling per provider.

## What Changes

- Add provider adapters in priority batches:
  - Batch 1: `parallel-search`, `firecrawl-search`.
- Add provider metadata for auth type, base URL, method, search types, cost/quota notes, timeout, and cache TTL.
- Normalize each provider into standard `SearchResponse`.
- Add provider-specific tests and schema updates.
- Keep domain-specific GitHub/code search out of general `/v1/search` unless a separate `search_type` is added later.

## Impact

### Affected Specifications
- `openspec/specs/additional-search-providers/spec.md` - Adds extra provider requirements.

### Affected Code
- `open-sse/config/searchRegistry.ts` - Provider registry entries.
- `open-sse/handlers/search.ts` - Request builders and response normalizers.
- `src/shared/validation/schemas.ts` - Provider enum/list updates if needed.
- `src/shared/constants/providers.ts` - Credential reuse wiring: `parallel-search` → `parallel` connection, `firecrawl-search` → existing `firecrawl` connection (so keys are entered via the existing Providers UI).
- `src/app/api/search/providers/route.ts` - Catalog/status display, including Configure links for the new providers in the search-tools UI.
- Tests under `tests/unit/search-*`.

### User Impact
- Hermes gets more fallback choices without provider-specific logic.
- Operators can choose search providers by cost, quality, privacy, and setup burden.

### API Changes
- New `/v1/search` provider IDs.
- No breaking response shape changes.

### Migration Required
- [ ] Database migration
- [ ] API version bump
- [ ] User communication needed
- [x] Documentation updates

## Timeline Estimate

Medium-large. Each adapter is small, but every provider needs reliable normalization and tests.

## Risks

- Provider APIs differ in result quality and shape. Mitigate with strict normalizers and capability flags.
- Some providers are paid or quota-limited. Mitigate with metadata and disabled-by-default config until credentials exist.
- Browser-scraped providers may be unstable. Mitigate by keeping DuckDuckGo/Bing adapters optional and clearly lower priority than official APIs.
- Google SERP scraper duplicates are out of scope. OmniRoute already has `serper-search` and `searchapi-search`; do not add `serpapi-search`.
- Jina duplicate work is out of scope. OmniRoute already has `jina-reader` fetch support and `jina-ai` model support; do not add `jina-search` without a separate approval for a distinct Jina search endpoint.
- `kagi-search`, `xai-search`, `duckduckgo-search`, and `bing-search` are out of scope by explicit project decision.
- `searcharvester-search` is out of scope because OmniRoute already has direct `searxng-search` support; a Tavily-compatible wrapper over SearXNG is not needed for this slice.
