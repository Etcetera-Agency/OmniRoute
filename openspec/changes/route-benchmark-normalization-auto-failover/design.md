# Design: Use the existing free Auto route for Structured Output

## Chosen flow

The internal scorer uses the exact channel `auto/general_high_so:free`.
`general_high` keeps the high quality band, `so` requires Structured Output
capability, and explicit `:free` retains the zero-cost tier. The request asks
for `reasoning_effort: "high"`; provider-specific sanitization remains owned
by OmniRoute's normal request pipeline.

Before this change, live read-only candidate checks returned 10 high/SO/free,
5 mid/SO/free, and 17 low/SO/free targets. This design uses only the high
channel; an empty pool is a blocked unrated result, not permission to downgrade
or remove constraints.

The processor will build the same strict JSON Schema request and pass it to the
ordinary `handleChat` path. It will not set `x-omniroute-connection`, add the
one-shot marker, set a provider/model pin, or call a provider endpoint itself.
The recognized built-in Auto channel takes precedence over a saved combo with
the same exact name, so a stored combo cannot replace this route's band, SO, or
free-tier filters.
The regular Auto resolver chooses only eligible targets in the requested
channel and advances to the next target after transient failures according to
its existing retry and cooldown rules. A later context-window/catalog expansion
must preserve an empty explicit free band as empty; it cannot restore the full
provider catalog. The strict zero-cost candidate gate remains authoritative for
every target.

If the whole Auto request still returns 429, the processor records the final
response and its retry headers. The existing benchmark queue persists the
cooldown and waits before another queue attempt. The scorer does not issue an
immediate duplicate request or retry the same connection outside Auto.

Before calling `handleChat`, the processor checks that Auto bands are enabled
and the persisted `freeAccessPolicy` equals `strict`. If either condition is
false or cannot be read, it records a blocked unrated result without dispatch.

## Pseudocode

```text
process(model, searchResults):
  if searchResults is empty:
    return no_search_candidates_unrated

  body = strictSchemaRequest(
    model = "auto/general_high_so:free",
    reasoning_effort = "high",
    targetModelIdentity = model,
    sources = searchResults
  )
  if injectionGuard(body) blocks:
    return blocked_untrusted_search_content

  request = internalAuthenticatedRequest(body)
  omit connection, provider, session, and model pin headers
  await existing normalization spacing
  response = ordinaryHandleChat(request, body)

  if response.status == 429:
    return normalization_request_failed_unrated with
      Retry-After or X-RateLimit-Reset for existing queue deferral
  if response is not successful:
    return normalization_request_failed_unrated

  records = parseStrictSchemaResponse(response)
  require exact target identity, returned URL, and literal source quote
  if validation fails:
    return normalization_response_invalid_unrated

  persist records as source_verified_review_required
  never write a production score
```

## Evidence and failure behavior

- Preserve the JSON Schema, injection guard, output identity checks, URL
  membership check, and literal quote check.
- Include the requested channel and actual response model/request ID in the
  processor receipt when the normal response exposes them. Do not fabricate a
  provider or connection receipt when it is unavailable.
- Let the standard Auto route own candidate attempts and 429 cooldown behavior.
  No second model request is issued by the scorer after a route-level failure.
- A missing eligible candidate, strict free gate failure, or unsupported SO
  capability remains unrated. There is no low/mid, non-SO, paid, or other
  provider fallback.
- Accepted evidence remains review-required and cannot update
  `benchmark_fitness` or another production score source.
