import {
  SEARCH_AUTO_PROVIDER_ORDER as UPSTREAM_SEARCH_AUTO_PROVIDER_ORDER,
  SEARCH_CREDENTIAL_FALLBACKS as UPSTREAM_SEARCH_CREDENTIAL_FALLBACKS,
  SEARCH_PROVIDERS as UPSTREAM_SEARCH_PROVIDERS,
  type SearchProviderConfig,
} from "@omniroute/open-sse/config/searchRegistry.ts";

export type { SearchProviderConfig };

// AICODE-NOTE: Hermes-owned search providers live in this overlay so upstream
// open-sse/config/searchRegistry.ts can merge cleanly during upstream pulls.
export const HERMES_SEARCH_PROVIDERS: Record<string, SearchProviderConfig> = {
  "parallel-search": {
    id: "parallel-search",
    name: "Parallel Search",
    baseUrl: "https://api.parallel.ai/v1/search",
    method: "POST",
    authType: "apikey",
    authHeader: "x-api-key",
    costPerQuery: 0.005,
    freeMonthlyQuota: 16000,
    searchTypes: ["web", "news"],
    defaultMaxResults: 5,
    maxMaxResults: 100,
    timeoutMs: 20_000,
    cacheTTLMs: 5 * 60 * 1000,
  },
  "firecrawl-search": {
    id: "firecrawl-search",
    name: "Firecrawl Search",
    baseUrl: "https://api.firecrawl.dev/v2/search",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0.002,
    freeMonthlyQuota: 500,
    searchTypes: ["web", "news"],
    defaultMaxResults: 5,
    maxMaxResults: 100,
    timeoutMs: 60_000,
    cacheTTLMs: 5 * 60 * 1000,
  },
  "gemini-grounded-search": {
    id: "gemini-grounded-search",
    name: "Gemini Grounded Search",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "POST",
    authType: "apikey",
    authHeader: "x-goog-api-key",
    costPerQuery: 0,
    freeMonthlyQuota: 0,
    searchTypes: ["web"],
    defaultMaxResults: 5,
    maxMaxResults: 20,
    timeoutMs: 15_000,
    cacheTTLMs: 5 * 60 * 1000,
  },
};

const UPSTREAM_DUCKDUCKGO_PROVIDER = UPSTREAM_SEARCH_PROVIDERS["duckduckgo-free"];

export const SEARCH_PROVIDERS: Record<string, SearchProviderConfig> = {
  ...Object.fromEntries(
    Object.entries(UPSTREAM_SEARCH_PROVIDERS).filter(([id]) => id !== "duckduckgo-free")
  ),
  ...HERMES_SEARCH_PROVIDERS,
  ...(UPSTREAM_DUCKDUCKGO_PROVIDER ? { "duckduckgo-free": UPSTREAM_DUCKDUCKGO_PROVIDER } : {}),
};

export const SEARCH_CREDENTIAL_FALLBACKS: Record<string, string> = {
  ...UPSTREAM_SEARCH_CREDENTIAL_FALLBACKS,
  "parallel-search": "parallel",
  "firecrawl-search": "firecrawl",
  "gemini-grounded-search": "gemini",
};

export const SEARCH_AUTO_PROVIDER_ORDER = [
  ...UPSTREAM_SEARCH_AUTO_PROVIDER_ORDER.filter((id) => id !== "perplexity-search"),
  "parallel-search",
  "firecrawl-search",
  "perplexity-search",
  "gemini-grounded-search",
] as const;

export const SEARCH_PROVIDER_IDS = Object.keys(SEARCH_PROVIDERS) as [string, ...string[]];

export function getAutoSearchProviders(searchType?: string): SearchProviderConfig[] {
  return SEARCH_AUTO_PROVIDER_ORDER.map((id) => SEARCH_PROVIDERS[id])
    .filter((provider): provider is SearchProviderConfig => Boolean(provider))
    .filter((provider) => !provider.fallbackOnly)
    .filter((provider) => (searchType ? supportsSearchType(provider, searchType) : true));
}

export function getSearchProvider(providerId: string): SearchProviderConfig | null {
  return SEARCH_PROVIDERS[providerId] || null;
}

export function supportsSearchType(
  providerOrId: SearchProviderConfig | string | null | undefined,
  searchType: string
): boolean {
  const provider =
    typeof providerOrId === "string" ? getSearchProvider(providerOrId) : providerOrId || null;
  if (!provider) return false;
  return provider.searchTypes.includes(searchType);
}

export function getAllSearchProviders(): Array<{
  id: string;
  name: string;
  searchTypes: string[];
}> {
  return Object.values(SEARCH_PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    searchTypes: p.searchTypes,
  }));
}

export function selectProvider(
  explicitProvider?: string,
  searchType?: string
): SearchProviderConfig | null {
  if (explicitProvider) {
    const provider = SEARCH_PROVIDERS[explicitProvider] || null;
    if (!provider) return null;
    if (searchType && !supportsSearchType(provider, searchType)) return null;
    return provider;
  }

  return getAutoSearchProviders(searchType)[0] || null;
}
