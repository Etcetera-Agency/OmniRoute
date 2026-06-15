# Design: Gemini Grounded Search Provider

## Provider ID

```text
gemini-grounded-search
```

This is distinct from:

```text
google-pse-search
```

`google-pse-search` uses Google Custom Search JSON API and requires `cx`. `gemini-grounded-search` uses Gemini API with native `googleSearch` grounding.

## Request Flow

Pseudocode:

```text
handleSearch(request):
  if provider == "gemini-grounded-search":
    credentials = resolveGeminiCredentials()
    geminiRequest = buildGeminiGroundedSearchRequest(request)
    geminiResponse = callGemini(geminiRequest, credentials)
    return normalizeGeminiGroundedSearch(geminiResponse, request)
```

## Gemini Request Shape

Use a Gemini model configured for Google Search grounding. The request asks Gemini to answer the query and ground the answer.

Pseudocode:

```text
buildGeminiGroundedSearchRequest(params):
  return {
    contents: [{
      role: "user",
      parts: [{ text: buildSearchPrompt(params) }]
    }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0.2
    }
  }
```

The adapter may use a configured default model such as a Gemini Flash model. Model choice stays config-driven, not hardcoded in business logic.

## Normalization

Pseudocode:

```text
normalizeGeminiGroundedSearch(response, params):
  answerText = extractCandidateText(response)
  chunks = response.candidates[].groundingMetadata.groundingChunks
  results = []

  for chunk in chunks:
    web = chunk.web
    if !web?.uri or !isHttpUrl(web.uri):
      continue
    results.push({
      title: web.title || web.uri,
      url: web.uri,
      snippet: deriveSnippet(answerText, web.uri),
      position: results.length + 1,
      score: null,
      published_at: null,
      favicon_url: null,
      content: null,
      metadata: null,
      citation: {
        provider: "gemini-grounded-search",
        retrieved_at: now,
        rank: results.length + 1
      },
      provider_raw: null
    })

  return SearchResponse(
    provider="gemini-grounded-search",
    query=params.query,
    results,
    answer=answerText
      ? { source: "gemini-grounded-search", text: answerText, model: configuredGeminiModel }
      : null
  )
```

`SearchResponse.answer` is the object shape
`{ source: string; text: string | null; model: string | null } | null`
(see `open-sse/handlers/search.ts` `SearchResponse`). The model answer goes in
`answer.text`, matching the spec scenario that asserts `answer.text`. Do not
assign the raw string to `answer`, and set `answer` to `null` when Gemini
returns no answer text.

Deduplicate by normalized URL. Respect `max_results`.

## Position In Automatic Routing

`gemini-grounded-search` is appended as the **final** entry of the configured
search order from `add-hermes-search-routing-support` (after
`perplexity-search`). It is answer-oriented rather than a pure SERP API, so it
acts as the last-resort LLM-backed fallback and is only reached when every
earlier configured provider is unavailable or returns no usable result. It is
not inserted ahead of the keyed SERP providers. It remains directly selectable
via explicit `provider: "gemini-grounded-search"`.

## Fallback Semantics

No valid grounded URLs means no usable result. In automatic routing, OmniRoute should continue to the next configured provider if one exists. When explicit provider is requested, return a normal empty-result response or provider error according to current `/v1/search` behavior.

