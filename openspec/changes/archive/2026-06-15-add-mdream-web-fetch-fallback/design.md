# Design: Mdream Web Fetch Fallback

## Provider Order

When request body has no `provider`, execute:

```text
mdream -> parallel-extract -> jina-reader -> tavily-search -> firecrawl
```

When request body has `provider` and no `fallback: true`, execute only that provider.

When request body has `provider` and `fallback: true`, start with that provider and then continue with the remaining compatible providers in configured order.

## Capability Routing

Mdream supports only Markdown/text extraction.

```text
format=markdown, depth=0, no wait_for_selector -> mdream eligible
format=html -> mdream skipped
format=links -> mdream skipped
format=screenshot -> mdream skipped
wait_for_selector set -> mdream skipped
depth > 0 -> mdream skipped
```

Firecrawl remains the final fallback for JavaScript rendering, screenshots, selector waiting, and depth.

Parallel Extract supports direct hosted URL extraction with an API key.

```text
format=markdown -> parallel-extract eligible
format=html -> parallel-extract eligible only when the API returns raw or converted HTML for the URL
format=links -> parallel-extract skipped unless the API exposes link extraction in the same endpoint
format=screenshot -> parallel-extract skipped
wait_for_selector set -> parallel-extract skipped
depth > 0 -> parallel-extract skipped
```

## Mdream URL Construction

Pseudocode:

```text
function buildMdreamUrl(inputUrl):
  parsed = new URL(inputUrl)
  require parsed.protocol in ["http:", "https:"]
  // Keep the full original URL, including scheme, so http and https
  // targets do not collapse to the same Mdream path.
  return "https://mdream.dev/p/" + inputUrl
```

This preserves scheme, host, path, and query. The scheme MUST be retained:
stripping it would make `http://example.com` and `https://example.com`
resolve to the same Mdream path and lose the caller's intended protocol.

The exact Mdream endpoint contract — path prefix (`/p/`), whether the scheme
is kept inline or passed as a query parameter, and any required headers — SHALL
be verified against the live Mdream service before coding, the same way the
Parallel Extract endpoint is verified below. Do not hardcode an unverified
prefix.

## Privacy Filter

The private/internal/loopback/link-local IP classification SHALL reuse the
existing OmniRoute outbound URL guard / SSRF filter rather than a hand-rolled
regex. Per the repo secure-defaults rule (`CLAUDE.md` → Security), prefer
`ssrf-req-filter` and the existing outbound guard path used by the other
fetch providers. The Mdream-specific layer only adds the extra checks below
on top of that shared guard.

Pseudocode (Mdream-specific layer on top of the shared SSRF guard):

```text
function assertPublicMdreamUrl(inputUrl, dataClass):
  parsed = new URL(inputUrl)
  reject if parsed.protocol not in ["http:", "https:"]
  // Delegate IP/host classification to the shared outbound guard:
  reject if sharedOutboundGuard.isBlocked(parsed)   // loopback, private, link-local, internal
  // Mdream-specific additions (public third-party leak prevention):
  reject if request carries cookies or Authorization
  reject if query key matches token/api_key/key/signature/session/auth/code
  reject if dataClass == "sensitive-health"
```

The filter runs before Mdream executor dispatch. Other providers still use the
existing outbound URL guard path directly.

## Parallel Extract Request

Pseudocode:

```text
function buildParallelExtractRequest(inputUrl, format):
  body = {
    url: inputUrl,
    objective: "Extract the main page content for LLM grounding"
  }
  if format == "markdown":
    body.output_format = "markdown"
  if format == "html":
    body.output_format = "html"
  return POST https://api.parallel.ai/v1beta/extract with bearer PARALLEL_API_KEY
```

The implementation SHALL verify the current Parallel Extract endpoint and field names before coding. Normalization SHALL reject missing URL, missing content, or empty content.

## Fallback Decision

Retry next compatible provider when:

```text
408
429
500..599
timeout
network error
empty content
provider cooldown
open circuit breaker
quota exhausted
401 or 403 provider credential failure
```

Do not automatically retry all providers when the page itself returns confirmed `400` or `404`.

## Attempt Telemetry

Telemetry is emitted as structured pino log fields, not a new database table.
This change does NOT add a migration or a `src/lib/db/` module. If a future
change needs queryable/persisted attempt history, that is a separate slice with
its own migration per the repo DB rules.

Emit per attempt (log fields):

```text
request_id
provider
url_host
format
latency_ms
status
content_bytes
fallback_reason
success
```

Do not store the full URL when the query contains potentially secret
parameters — log `url_host` only.

## Parallel Credential Coordination

`parallel-extract` (this change) and `parallel-search` (the
`add-additional-search-providers` change) are two distinct provider IDs from
the same vendor (parallel.ai) and both authenticate with `PARALLEL_API_KEY`.
Whichever change lands first SHALL define the shared credential resolution
(env var name + provider connection mapping); the second change reuses it
rather than introducing a second key or duplicate credential wiring.
