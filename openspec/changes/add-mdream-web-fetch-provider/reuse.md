# Selected Reuse

## R1 — Adapt the Historical Mdream Adapter Algorithm

- Project: Etcetera-Agency/OmniRoute fork.
- Immutable revision: `916c0eaa61fe8ebd32441a407aacd3b6251a7aa4`.
- Source: `open-sse/executors/mdream-fetch.ts`; symbols `buildMdreamFetchUrl`, `validateMdreamRequest`, `mdreamFetch`.
- Pertinent tests: `tests/unit/web-fetch-handler.test.ts`, tests for raw hosted URL construction, secret query keys, private/local URLs, Authorization/Cookie and sensitive-health rejection. Inspected source and assertions; execution NOT RUN for this proposal. Historical commit-message test claims are not fresh verification.
- License: repository `LICENSE` at that revision is MIT, copyright 2026 diegosouzapw. Preserve repository license and copyright. No upstream converter implementation is copied or redistributed.
- Mode: adapt the inspected small adapter algorithm inside the same project; do not restore the historical commit wholesale.

Inspected path: input options enter validation; public URL guard and private-data checks run before `fetch`; the builder combines a fixed Mdream base with host/path/query; `mdreamFetch` performs keyless GET, maps text to `WebFetchResult`, handles abort/error and clears its 20,000 ms timer in `finally`. This actual code path supports adapting the algorithm, rather than deriving executable behavior from a README.

Target: new `open-sse/executors/mdream-fetch.ts`, dispatched by the current `handleWebFetch`. Retain Markdown-only behavior, HTTPS target-query rejection, fixed endpoint, bounded deadline, text normalization and empty-content rejection. Use the fixed browser-style HTTP header set that produced 10/10 successful raw hosted responses; OmniRoute starts no browser, and the probe did not identify which individual headers are required. Adapt the request-header boundary to today's route: incoming Authorization authenticates the OmniRoute caller and is never sent upstream; the REST route rejects sensitive-health before execution. Use fixed sanitized failure descriptions instead of reflecting upstream body/input. Ensure the new provider's route log cannot expose rejected URLs.

Do not adopt historical `webFetchRegistry.ts`, automatic Mdream-first fallback, Parallel executor, telemetry architecture or compatibility behavior. Their integration policy is outside the accepted explicit-only scope, not evidence of missing current infrastructure.

## R2 — Reuse Current Routing, Guard and Catalog Contracts

- Project/revision: selected OmniRoute base `9ff021bc2d79b63b730be14d946c38ed1ad83fe9`, MIT under root `LICENSE`.
- Exact sources: `open-sse/handlers/webFetch.ts` provider arrays/sets and dispatch; `src/app/api/v1/web/fetch/route.ts` explicit target resolution and fallback exclusions; `src/shared/network/outboundUrlGuard.ts` public-URL parser; `src/app/api/search/providers/route.ts` fetch definitions/status mapping; REST/MCP input schemas and MCP descriptions listed in [design.md](design.md); `src/shared/schemas/searchTools.ts` and `ProviderCatalog.tsx` for catalog price/quota representation.
- Mode: reuse existing code paths with narrow provider registration and one executor call. No new registry, framework, connection storage or generic option layer.
- Pertinent test evidence: current `tests/unit/context7-provider.test.ts` asserts explicit-only/anonymous registration and restrictive MCP input; current handler tests exercise dispatch/error behavior; integration catalog tests assert credential statuses and catalog shape; UI catalog tests cover existing cards. Inspected, NOT RUN during authoring.
- Demonstrated gap: current handler/provider enums do not include Mdream, dispatch has no Mdream branch, and fetch catalog status is credential-based. Existing abstractions cover routing and response shape but cannot execute/select Mdream until these bounded additions are made.

## Hosted Documentation Boundary

[mdream.dev](https://mdream.dev/) documents the hosted URL conversion shape, public input and that Mdream stays free. The [official README at a5b424557a4b8d715ecbaa6c0d375e8bb958eb07](https://github.com/harlan-zw/mdream/blob/a5b424557a4b8d715ecbaa6c0d375e8bb958eb07/packages/mdream/README.md) describes local converter options. Those options supply no hosted-parameter contract. No npm/native/WASM package is added; no private hosted implementation reuse is claimed. A 10-request direct HTTP set with Chrome-style headers returned Markdown 200; a prior set without them returned Cloudflare `browser_signature_banned`. Header necessity, RPM and redirect security remain unverified.
