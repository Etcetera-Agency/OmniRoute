export const WEB_FETCH_PROVIDER_ORDER = [
  "mdream",
  "parallel-extract",
  "jina-reader",
  "tavily-search",
  "firecrawl",
] as const;

export type WebFetchProviderId = (typeof WEB_FETCH_PROVIDER_ORDER)[number];

export interface WebFetchProviderConfig {
  id: WebFetchProviderId;
  name: string;
  costPerQuery: number;
  freeMonthlyQuota: number;
  fetchFormats: string[];
  authType: "apikey" | "none";
}

export const WEB_FETCH_PROVIDERS: Record<WebFetchProviderId, WebFetchProviderConfig> = {
  mdream: {
    id: "mdream",
    name: "Mdream",
    costPerQuery: 0,
    freeMonthlyQuota: 999999,
    fetchFormats: ["markdown", "text"],
    authType: "none",
  },
  "parallel-extract": {
    id: "parallel-extract",
    name: "Parallel Extract",
    costPerQuery: 0.001,
    freeMonthlyQuota: 0,
    fetchFormats: ["markdown", "html"],
    authType: "apikey",
  },
  "jina-reader": {
    id: "jina-reader",
    name: "Jina Reader",
    costPerQuery: 0.0005,
    freeMonthlyQuota: 1000,
    fetchFormats: ["markdown", "text"],
    authType: "apikey",
  },
  "tavily-search": {
    id: "tavily-search",
    name: "Tavily Extract",
    costPerQuery: 0.001,
    freeMonthlyQuota: 1000,
    fetchFormats: ["markdown", "text"],
    authType: "apikey",
  },
  firecrawl: {
    id: "firecrawl",
    name: "Firecrawl",
    costPerQuery: 0.002,
    freeMonthlyQuota: 500,
    fetchFormats: ["markdown", "html", "links", "screenshot"],
    authType: "apikey",
  },
};

export function getWebFetchProvider(providerId: string): WebFetchProviderConfig | null {
  return WEB_FETCH_PROVIDERS[providerId as WebFetchProviderId] ?? null;
}
