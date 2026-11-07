# Mdream web-fetch design

## Selected Outcome

Add one explicitly selected, anonymous provider named `mdream` to OmniRoute's existing URL-fetch path. The hosted service returns Markdown. No model or mode selection exists in this integration. The adapter accepts HTTPS destinations because the hosted URL shape omits the source scheme. The existing route owns authentication, policy, keyless admission and HTTP wrapping; the handler owns dispatch; the executor owns destination validation, hosted request and response normalization.

Baseline: `9ff021bc2d79b63b730be14d946c38ed1ad83fe9`. Historical adaptation reference: `916c0eaa61fe8ebd32441a407aacd3b6251a7aa4`. Source checks dated 2026-11-07. [Reuse boundary](reuse.md).

## Original Sources and Decisions

| ID  | Source                                                                                                                                                                                                      | Disposition and evidence status                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Owner-authorized task, accepted package brief                                                                                                                                                               | Add anonymous Mdream; author may resolve model/parameter presentation from evidence. Current accepted design is fetch, explicit-only, keyless, Markdown only. Authorization is distinct from runtime proof.                         |
| O2  | [Mdream hosted homepage](https://mdream.dev/), read 2026-11-07                                                                                                                                              | Documents direct `mdream.dev/<url>` conversion, public website input, and says Mdream stays free. It publishes no numeric RPM/monthly quota or versioned SLA. A bounded raw HTTP probe is recorded below.                           |
| O3  | [Mdream package README at a5b424557a4b8d715ecbaa6c0d375e8bb958eb07](https://github.com/harlan-zw/mdream/blob/a5b424557a4b8d715ecbaa6c0d375e8bb958eb07/packages/mdream/README.md), API Reference and Options | `htmlToMarkdown` accepts local `minimal`, `clean`, `frontmatter` and `format` options. These are converter-library options, not documented hosted URL endpoint flags. No converter code is imported.                                |
| O4  | Owner/project rules, `AGENTS.md`; current `openspec/README.md`, `openspec/TODO.md` and existing delta structure                                                                                             | Separate branch; tests-first implementation; no compatibility layer; Code Simplifier/review before completion; root TODO remains authoritative for next steps. Existing README concerns quality bands, not a Mdream implementation. |

Chronology: historical fork behavior is implementation evidence, not authorization to restore its registry or automatic fallback policy. The current accepted scope supersedes those historical integration choices. Local converter capabilities do not establish hosted options.

## Referenced Implementation Inventory

All B entries refer to the selected base above; H1 refers to the historical commit above. These are bounded source inspections, not claims about deployed behavior.

The current fetch catalog has seven entries. Its route comment says four; update it to eight when adding Mdream. The MCP tool description and README row also currently enumerate providers and imply automatic failover, so update them to state that Mdream is keyless, Markdown-only and explicit-only.

| ID  | Exact locator                                                                                                                                                                                                                                                                                                                                                                                                              | Present behavior / gap                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `open-sse/handlers/webFetch.ts`: `WebFetchRequest`, `WEB_FETCH_PROVIDERS`, `EXPLICIT_ONLY_WEB_FETCH_PROVIDERS`, `ANONYMOUS_CAPABLE_WEB_FETCH_PROVIDERS`, `handleWebFetch`                                                                                                                                                                                                                                                  | Existing provider union, policy sets, normalization types and dispatch. Context7 demonstrates explicit-only anonymous integration. Mdream dispatch is absent.                                                                                                                                                       |
| B2  | `src/app/api/v1/web/fetch/route.ts`: `resolveExplicitTarget`, `resolveAutoSelectTarget`, `findNextFallbackProvider`, `executeWithFallback`, `POST`                                                                                                                                                                                                                                                                         | Explicit requests never fall back; auto/fallback skip explicit-only set. Anonymous admission observes `keyAdmitsKeylessProviders`. Client Authorization is consumed for OmniRoute authentication. Existing log includes the input URL; Mdream rejection must occur without logging secret URL contents.             |
| B3  | `src/shared/validation/schemas/apiV1.ts`: `v1WebFetchSchema`                                                                                                                                                                                                                                                                                                                                                               | Existing REST provider enum, Markdown default, depth/selector/metadata fields. No caller-supplied target-fetch headers.                                                                                                                                                                                             |
| B4  | `open-sse/mcp-server/schemas/tools.ts`: `webFetchInput`; `open-sse/mcp-server/tools/webTools.ts`: `handleWebFetch`                                                                                                                                                                                                                                                                                                         | Existing restrictive provider enum and forwarder to `/v1/web/fetch`; both require the new ID. MCP continues using the REST route and its policy.                                                                                                                                                                    |
| B5  | `src/app/api/search/providers/route.ts`: `FETCH_PROVIDERS`, `resolveProviderStatus`, `GET`; `src/shared/schemas/searchTools.ts`: `SearchProviderCatalogItemSchema`; `src/app/(dashboard)/dashboard/search-tools/components/ProviderCatalog.tsx`: `ProviderCard`; `src/app/(dashboard)/dashboard/search-tools/components/SearchToolsConfigPane.tsx`; `src/app/(dashboard)/dashboard/search-tools/components/SearchForm.tsx` | Catalog already supports `kind: fetch`, Markdown formats and `configured` status. Credential-only status resolution returns `missing` without a connection; missing cards cannot be selected. Mdream needs a keyless-ready catalog status. All three quota displays must tolerate an unpublished monthly allowance. |
| B6  | `src/shared/network/outboundUrlGuard.ts`: `parseOutboundUrl`, `parseAndValidatePublicUrl`; `src/shared/network/privateHost.ts`: host classification                                                                                                                                                                                                                                                                        | Reuse existing HTTP(S), embedded-userinfo and private/local-host checks; no separate security parser. Host validation is syntactic classification, not DNS resolution or hosted-service SSRF verification.                                                                                                          |
| B7  | `open-sse/executors/parallel-fetch.ts`: `parallelFetch`, `fail`; `tests/unit/context7-provider.test.ts`; `tests/unit/web-fetch-handler.test.ts`; `tests/integration/search-providers-catalog.test.ts`; `tests/unit/ui/search-tools-provider-catalog.test.tsx`                                                                                                                                                              | Existing Markdown-only error shape, anonymous registration assertions, handler mocks and catalog credential/card tests supply project patterns. Inspected; NOT RUN during proposal authoring.                                                                                                                       |
| H1  | `open-sse/executors/mdream-fetch.ts`: `buildMdreamFetchUrl`, `validateMdreamRequest`, `mdreamFetch`; `tests/unit/web-fetch-handler.test.ts`, at historical commit                                                                                                                                                                                                                                                          | Actual keyless GET construction, 20 s timer, public-URL/secret-query/header/data-class guards, text normalization and cleanup. Tests assert URL construction and rejection classes. Historical fallback/telemetry integration is outside selected reuse. Inspected; NOT RUN.                                        |

## External Discovery Boundary

| ID  | Scope / exact locator                                                                                                                                                  | Selected use and limit                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Official hosted endpoint documentation O2, followed to the official package README O3; HEAD resolved with `git ls-remote https://github.com/harlan-zw/mdream.git HEAD` | Resolve remote-versus-local parameter ambiguity. No new runtime library is needed for an HTTP adapter. No broader converter framework search is needed for this bounded hosted-provider request. |

The remote service's private implementation, redirect behavior, internal DNS policy, RPM/monthly quota, uptime and output quality are unverified. A bounded off-host probe first sent 10 requests without browser-style headers; all returned Cloudflare 403 `browser_signature_banned`. A second 10-request set using the fixed Chrome 131 User-Agent plus Accept, Accept-Language, Referer, Sec-Fetch and Upgrade-Insecure-Requests headers returned 200 Markdown (31 bytes per response). The successful set ran at roughly 19 requests/minute including response latency; neither set returned rate-limit headers. Headers were tested as a group, so the necessary individual fields and RPM ceiling are unknown. This verifies a small raw hosted conversion sample only, not OmniRoute route behavior or unlimited usage (see root `openspec/TODO.md`). Hosted documentation is mutable and has no immutable service version.

## Request and Routing Contract

REST retains the existing body: `url`, optional `provider`, `format`, `depth`, `wait_for_selector`, `include_metadata`. Set `provider` to exactly `mdream`. Default `format` is `markdown`; other existing formats produce 400 before any upstream call. Metadata defaults false. Common depth and selector fields remain accepted by the existing schema but have no Mdream behavior and are never added to its hosted URL.

Add Mdream to both existing explicit-only and anonymous-capable sets. This allows explicit execution without a connection when the caller's connection scope admits keyless providers. It does not bypass `REQUIRE_API_KEY`, API-key policy, or a scoped key that excludes `noauth`. An explicit Mdream request makes exactly one attempt and returns its own result. Neither auto-selection nor quota fallback may contact Mdream.

Add `mdream` to REST/MCP provider enums and their TypeScript input unions. No search registry entry, search type, chat/completion model, alias, or credential provider is added.

## Privacy Boundary

Before network I/O, reuse `parseAndValidatePublicUrl`. Reject malformed/non-HTTP(S) input, embedded username/password, and private/local destinations with sanitized 400. Check each parsed query parameter name case-insensitively against `token`, `api_key`, `apikey`, `key`, `signature`, `session`, `auth`, `code`; any match is 400. Preserve other query parameters as target URL data.

Carry the incoming `x-hermes-data-class` header as internal fetch execution context, separate from the validated JSON body. If its value is exactly `sensitive-health`, reject Mdream with 400 before network I/O. Do not add a public body option or generic target-header forwarding feature.

OmniRoute caller Authorization and cookies remain usable for their existing authentication purposes. They, configured provider credentials, the data-class marker and all other inbound headers are never forwarded to Mdream. The executor sends a fixed browser-style header set observed in the successful probe: Chrome 131 User-Agent, Markdown Accept, Accept-Language, Mdream Referer, document/navigation Sec-Fetch fields and Upgrade-Insecure-Requests. This is a direct HTTP request; OmniRoute starts no browser. The probe did not isolate which fields Cloudflare requires.

For Mdream, route logging must not serialize the raw input URL, query string, incoming auth/cookies or upstream error body. Use provider, format and safely parsed hostname only; a failed parse supplies no hostname. Validation errors use fixed descriptions without echoing rejected input. This is a narrow change to the new Mdream path.

## Hosted Execution and Normalization

Use the fixed service base `https://mdream.dev`. Build the request URL from the parsed target's `host`, `pathname`, `search`; omit source scheme, embedded credentials and fragment. Example: `https://example.com/docs?q=hello#part` becomes `https://mdream.dev/example.com/docs?q=hello`. A target query key named `minimal` remains target data; OmniRoute does not interpret it as a remote option.

Language-neutral pseudocode:

```text
if requested format is not markdown: return sanitized 400
parse target through existing public-URL guard
if target scheme is not https: return sanitized 400
if target query has a forbidden name: return sanitized 400
if incoming x-hermes-data-class is exactly sensitive-health: return sanitized 400 in the route
construct fixed-base Mdream URL using host + path + query
start one 20,000 ms abort deadline
try:
    GET constructed URL, supplying only the fixed tested request headers
    if upstream is non-success: return same status with fixed sanitized description
    read complete text, trim outer whitespace
    if content is empty: return sanitized 502
    return normalized success
on deadline abort: return sanitized 504
on network/read failure: return sanitized 502
finally: clear deadline timer
```

The deadline covers request plus body reading and is cleared on every outcome. No retry, fallback, per-request state persistence or new cache is introduced. Concurrent requests hold independent timers and buffers. Use existing Fetch behavior rather than adding a crawler or redirect subsystem. Guarding the submitted URL does not prove the hosted service's own redirect destinations are public.

Successful `WebFetchResult.data` contains `provider: mdream`, the caller's original `url`, trimmed Markdown `content`, `links: []`, `screenshot_url: null`. `metadata` is null by default; when requested it is `{title: null, description: null}` because no structured metadata contract is documented. Do not parse title or links heuristically.

Map upstream non-2xx status directly into the existing failed-result contract, with a fixed Mdream status message. Use existing error helpers. Empty successful response is 502; deadline is 504; network or body-read failure is 502. Explicit failures trigger no second provider. Raw upstream bodies, URLs and stack traces must not appear in error responses.

## Catalog Contract

Append a single Mdream entry to existing fetch definitions: ID `mdream`, name `Mdream`, `kind: fetch`, `fetchFormats: [markdown]`, `costPerQuery: 0`, `freeMonthlyQuota: null`. The hosted homepage says Mdream stays free but publishes no RPM or monthly allowance; null quota does not claim unlimited use. Allow null monthly quota in the catalog schema and show no monthly quota until a numeric allowance is published. Return `status: configured` without requiring a connection, using the catalog's existing selectable-status vocabulary. This status means keyless capability readiness, not a live health probe. Preserve existing management authentication and other providers' status resolution.

## Traceability and Checks

| Requirement                   | Sources          | Reuse / gap                               | Task    | Focused evidence required                                                                                                   |
| ----------------------------- | ---------------- | ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| M1 provider contract          | O1–O3, B1, B3–B4 | R1, current missing ID/dispatch           | 1, 2    | REST/MCP enum acceptance; MCP description; handler dispatch; non-Markdown zero-call failure                                 |
| M2 explicit anonymous routing | O1, B1–B2        | R2 existing routing sets and scope policy | 1, 3    | No-connection success; scoped key denial; no auto/fallback attempt                                                          |
| M3 public-data protection     | B2–B3, B6, H1    | R1/R2 guards and route context check      | 1, 2, 3 | Unsafe URL/query/data class and HTTP targets rejected with zero calls; auth not forwarded/logged                            |
| M4 hosted result lifecycle    | O2, B1, B7, H1   | R1 adapter algorithm                      | 1, 2    | Exact URL/header capture; normalized content/metadata; status, empty, abort/read failure; timer cleanup                     |
| M5 usable fetch catalog       | O1, B5, B7       | R2 existing catalog vocabulary            | 1, 4    | One fetch-only usable item, Markdown only, zero cost, unknown monthly quota, no connection required, old statuses preserved |

## Review and Completion Boundary

Author checked the accepted scope against current dispatch, REST/MCP schemas, catalog behavior and historical executor/tests. Independent source-fidelity and simplicity/reuse reviews remain parent-owned gates; self-inspection is not independent review. `reuse.md` is a Markdown provenance artifact; CLI validation alone cannot verify it.

Implementation, automated tests, hosted conversion smoke, deployment and archive are not established by this proposal. Required next steps and any separate owner-dependent live checks belong in repository `openspec/TODO.md`; the package does not silently authorize deployment, production probes or push.
