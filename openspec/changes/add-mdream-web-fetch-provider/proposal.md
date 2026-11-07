# Add Mdream web-fetch provider

## Why

OmniRoute already accepts a URL through `POST /v1/web/fetch` and returns normalized content. The selected base, `9ff021bc2d79b63b730be14d946c38ed1ad83fe9`, has no Mdream executor or fetch-provider entry. Mdream documents a public `mdream.dev/<url>` conversion endpoint, which fits this URL-to-Markdown contract. It does not establish a query-search API or model catalog.

## What Changes

- Add provider ID `mdream` to the existing web-fetch handler, REST validation and MCP web-fetch input schema.
- Add a keyless executor for the fixed hosted endpoint. Support Markdown only, one upstream attempt, a 20,000 ms deadline, normalized responses and sanitized failures.
- Mark Mdream explicit-only and anonymous-capable using the existing provider sets. Preserve client authentication, API-key policy and keyless connection-scope admission.
- Reject unsafe destinations, embedded URL credentials, secret-bearing query parameters and requests marked `sensitive-health` before sending a URL to Mdream. Use the exact fixed browser-style HTTP headers from the bounded successful probe; never launch a browser or forward caller headers.
- Expose Mdream as a usable `kind: fetch` catalog entry with `fetchFormats: [markdown]`, zero cost and an unknown monthly quota. The hosted homepage says Mdream stays free, but publishes no RPM or monthly allowance.
- Update the MCP tool description and README so explicit-only Mdream behavior is clear.

This package adds no query-search provider, model IDs, hosted mode flags, auto-selection or fallback-order changes, local converter dependency, credential setup, compatibility aliases or unrelated registry refactor.

## Impact

- Capability: new `web-fetch-providers` requirements.
- Runtime: `open-sse/handlers/webFetch.ts`, new `open-sse/executors/mdream-fetch.ts`, REST request schema/route and existing MCP web-fetch schema.
- Discovery: `src/app/api/search/providers/route.ts`, catalog schema and nullable-quota display, and MCP descriptions in `open-sse/mcp-server/schemas/tools.ts` and `open-sse/mcp-server/README.md`.
- Verification: focused executor, handler, route/scope, schema/MCP and catalog tests, followed by core type checking and strict OpenSpec validation.

Evidence, source limits and requirement-to-check mapping: [design.md](design.md). Selected adaptation provenance: [reuse.md](reuse.md). Ordered tests-first work: [tasks.md](tasks.md).

## Acceptance Boundary

Implementation and focused checks are complete on the feature branch. A raw off-host sample returned Markdown with the tested fixed headers; that does not prove deployed OmniRoute route behavior, sustained availability or an RPM ceiling. The pending controlled `/v1/web/fetch` request after an approved merge/deployment is tracked in repository `openspec/TODO.md`; this change does not authorize push, deployment or host image builds.
