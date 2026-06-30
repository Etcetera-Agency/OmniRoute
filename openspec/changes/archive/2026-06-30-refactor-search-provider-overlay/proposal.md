# Change: Move fork search providers into overlay registry

## Why

Upstream changes in `open-sse/config/searchRegistry.ts` conflict with Hermes-owned
search providers because the fork adds `parallel-search`, `firecrawl-search`, and
`gemini-grounded-search` directly to the upstream registry file. Future upstream pulls
should only have to reconcile upstream providers in that file.

## What Changes

- Keep `open-sse/config/searchRegistry.ts` limited to upstream search providers.
- Add a fork-owned overlay registry under `src/lib/search/` that merges upstream
  providers with Hermes providers.
- Route Hermes-owned search consumers through the overlay registry for provider
  lists, credential fallbacks, configured order, schema validation, and catalog data.
- Extend `open-sse/handlers/search.ts` so callers may pass a resolved
  `SearchProviderConfig`; provider execution no longer has to look up Hermes provider
  IDs in the upstream registry.
- Preserve public `/v1/search`, `/api/search/providers`, stats, analytics, and
  internal search execution behavior.

## Pseudocode

```ts
// src/lib/search/providerRegistry.ts
import * as upstream from "@omniroute/open-sse/config/searchRegistry.ts";

const HERMES_SEARCH_PROVIDERS = {
  "parallel-search": { ... },
  "firecrawl-search": { ... },
  "gemini-grounded-search": { ... },
};

export const SEARCH_PROVIDERS = {
  ...upstream.SEARCH_PROVIDERS,
  ...HERMES_SEARCH_PROVIDERS,
};

export const SEARCH_CREDENTIAL_FALLBACKS = {
  ...upstream.SEARCH_CREDENTIAL_FALLBACKS,
  "parallel-search": "parallel",
  "firecrawl-search": "firecrawl",
  "gemini-grounded-search": "gemini",
};

export function getSearchProvider(id) {
  return SEARCH_PROVIDERS[id] ?? null;
}
```

```ts
// src/lib/search/searchChain.ts
const attempt = { config: getSearchProvider(providerId), credentials };
await handleSearch({
  provider: attempt.config.id,
  providerConfig: attempt.config,
  credentials: attempt.credentials,
});
```

```ts
// open-sse/handlers/search.ts
const primaryConfig = options.providerConfig ?? getSearchProvider(options.provider);
```

## Impact

- Upstream registry diffs shrink: Hermes providers live outside `open-sse/config/searchRegistry.ts`.
- Hermes endpoints still expose all 16 search providers.
- `open-sse/handlers/search.ts` remains able to execute upstream providers by ID and fork
  providers by resolved config.
