# Change: Harden upstream routing and release integration without losing Hermes overlays

## Why

The fork has intentionally separated Hermes provider registries and ordered chains from
upstream OmniRoute. Upstream `main` now contains quota-aware credential selection, a shared
native Firecrawl search adapter, web-fetch quota status handling, per-attempt search proxy
binding, per-credential Firecrawl base URLs, and release workflow guardrails. Copying those
changes wholesale would erase Hermes ordering, provider aliases, fallback overlays, image
workflows, or the deliberate removal of the Node compatibility schedule. The fork needs one
explicit integration boundary that adopts the hardening while preserving those contracts.

## What Changes

- Route fork-owned automatic and explicit search credential resolution through
  `getProviderCredentialsWithQuotaPreflight`, preserving alias credential fallbacks, ordered
  overlay providers, and the existing rate-limited response shape.
- Make the native Firecrawl search request/normalization helper reusable by both `firecrawl`
  and the fork-owned `firecrawl-search` alias. Keep both IDs, schemas, catalogs, quota values,
  timeout values, URL filtering, body options, and citation IDs unchanged until a separate
  canonicalization change is approved.
- Apply the same quota preflight/status semantics to the fork web-fetch resolver and chain:
  skip blocked providers during automatic routing, return a rate-limited response when the
  pool is exhausted, and never silently fall back from an explicit provider unless the request
  explicitly enables fallback.
- Port the release search proxy boundary. Every provider attempt receives the selected
  connection ID and API-key policy ID, resolves its own proxy, executes inside that proxy
  context, and emits sanitized proxy telemetry without query strings, credentials, or tokens.
- Extend Firecrawl fetch base resolution with canonical per-credential `baseUrl` and
  `providerSpecificData.baseUrl` support while retaining `FIRECRAWL_BASE_URL`; custom/self-hosted
  endpoints do not require an API key, while the public cloud endpoint still does.
- Selectively port upstream workflow hardening: self-target PR and generated-agent-skill
  checks, pinned scanner/action versions, base-relative quality ratchets, Electron artifact
  merge/verification, npm same-repository artifact and install-upgrade guards, and env-safe
  Docker version resolution. Preserve Hermes GHCR/DockerHub/image workflows and all intentional
  no-schedule workflow decisions.

## Impact

- Affected specifications: `search-routing`, `additional-search-providers`,
  `web-fetch-routing`, and the new `release-workflow-hardening` capability.
- Affected runtime paths: `src/lib/search/searchChain.ts`,
  `open-sse/handlers/search/firecrawlSearch.ts`, `open-sse/handlers/search.ts`,
  `open-sse/handlers/search/searchProxy.ts`, `src/lib/webfetch/webFetchCredentials.ts`,
  `open-sse/handlers/webFetchChain.ts`, and `open-sse/executors/firecrawl-fetch.ts`.
- Affected release paths: `.github/workflows/ci.yml`, `quality.yml`, `codeql.yml`,
  `electron-release.yml`, `npm-publish.yml`, `docker-publish.yml`, and the existing workflow
  validation/test scripts.
- No provider ID is removed or renamed. No Hermes overlay registry is replaced. No nightly
  schedule is reintroduced. API clients gain deterministic quota/proxy behavior but retain the
  current request and response schemas.
- This change closes deferred TODO items 11–16; any newly discovered follow-up work must be
  recorded in `openspec/TODO.md` during the implementation/archive phase.
