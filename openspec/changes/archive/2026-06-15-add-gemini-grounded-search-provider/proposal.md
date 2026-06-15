# Proposal: Add Gemini Grounded Search Provider

## Why

OmniRoute already supports Gemini native `googleSearch` grounding in chat translation, but `/v1/search` cannot use it as a search provider. Hermes needs a final high-quality LLM-backed search fallback that returns standard OmniRoute search results and does not require Hermes to implement Gemini-specific logic.

**Context**:
- `open-sse/services/webSearchFallback.ts` proves Gemini targets can use native `googleSearch` in chat/tool flow.
- `open-sse/translator/request/openai-to-gemini.ts` maps Google Search tools to Gemini `googleSearch`.
- `open-sse/translator/response/gemini-to-openai.ts` reads Gemini `groundingMetadata`.
- `/v1/search` currently routes through `open-sse/handlers/search.ts` and `open-sse/config/searchRegistry.ts`, not through chatCore.

**Current state**: Gemini grounding exists only in LLM request/response translation paths, not as a `/v1/search` provider.

**Desired state**: `/v1/search` can use provider `gemini-grounded-search`, call Gemini with Google Search grounding, map grounded sources to standard `SearchResponse`, and expose it as a normal search provider.

## What Changes

- Add `gemini-grounded-search` to search provider registry.
- Implement a Gemini grounded search executor path inside `open-sse/handlers/search.ts` or a dedicated helper module.
- Use Gemini credentials from an existing Gemini provider connection.
- Call Gemini with `googleSearch` enabled and a prompt/request designed for search result extraction.
- Map `groundingMetadata.groundingChunks[].web` entries with valid `http`/`https` URLs into `SearchResult[]`.
- Put the model answer into `answer.text` when available.
- Drop grounded chunks without valid URLs.
- Add tests for registry, credential resolution, grounding metadata mapping, empty grounding fallback, and `/v1/search` response shape.

## Impact

### Affected Specifications
- `openspec/specs/gemini-grounded-search/spec.md` - Adds Gemini grounded search behavior.

### Affected Code
- `open-sse/config/searchRegistry.ts` - Register `gemini-grounded-search`.
- `open-sse/handlers/search.ts` - Execute Gemini grounded search and normalize response.
- `src/app/api/search/providers/route.ts` - Show provider status/catalog entry.
- `src/shared/validation/schemas.ts` - Accept provider ID if enum/list requires update.
- Tests under `tests/unit` and/or `tests/integration`.

### User Impact
- Hermes can use `/v1/search` with `provider: "gemini-grounded-search"` or configured final fallback.
- Existing chat web-search behavior stays unchanged.
- Existing `google-pse-search` remains separate.

### API Changes
- `GET /v1/search` provider list includes `gemini-grounded-search`.
- `POST /v1/search` accepts `provider: "gemini-grounded-search"`.
- Response shape stays standard `SearchResponse`.

### Migration Required
- [ ] Database migration
- [ ] API version bump
- [ ] User communication needed
- [x] Documentation updates

## Timeline Estimate

Medium. Main work is adapter glue, robust response parsing, and tests.

## Risks

- Gemini may produce an answer with sparse grounding chunks. Mitigate by treating no valid URLs as an empty usable result so routing can fallback.
- Gemini grounded search is answer-oriented, not a pure SERP API. Mitigate by mapping citations to results and preserving the answer separately in `answer.text`.
- Credential ambiguity. Mitigate by reusing existing Gemini provider credential resolution and documenting required provider setup.

