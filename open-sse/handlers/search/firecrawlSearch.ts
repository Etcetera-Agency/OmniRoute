import type { SearchProviderConfig } from "../../config/searchRegistry.ts";
import { parseAndValidatePublicUrl } from "@/shared/network/outboundUrlGuard";

export interface FirecrawlSearchParams {
  query: string;
  searchType: string;
  maxResults: number;
  token?: string;
  baseUrl?: string;
  providerSpecificData?: Record<string, unknown>;
  country?: string;
  language?: string;
  timeRange?: string;
  domainFilter?: string[];
  contentOptions?: {
    full_page?: boolean;
    format?: string;
  };
  providerOptions?: Record<string, unknown>;
}

export type FirecrawlSearchVariant = {
  providerId: string;
  timeoutMs?: number;
  freeMonthlyQuota?: number;
  invalidUrlPolicy?: "drop" | "preserve";
  citationProvider?: string;
  aliasBody?: {
    ignoreInvalidURLs?: boolean;
    scrapeOptionsFromContent?: boolean;
  };
};

export type FirecrawlNormalizedHit = {
  title?: string;
  url?: string;
  snippet?: string;
  published_at?: string | null;
  image_url?: string;
  source_type?: string;
  category?: string;
  full_text?: string;
  text_format?: string;
};

type FirecrawlSearchHit = {
  title?: string;
  url?: string;
  link?: string;
  description?: string;
  snippet?: string;
  markdown?: string;
  html?: string;
  content?: string;
  date?: string | null;
  published_at?: string | null;
  imageUrl?: string | null;
  category?: string;
  metadata?: {
    title?: string;
    sourceURL?: string;
    publishedTime?: string | null;
  };
};

const FIRECRAWL_SOURCE_TYPES = new Set([
  "article",
  "blog",
  "forum",
  "video",
  "academic",
  "news",
  "other",
]);

export type FirecrawlSearchEnvelope = {
  data?: {
    web?: FirecrawlSearchHit[];
    news?: FirecrawlSearchHit[];
  };
};

function parseDomainFilter(domainFilter?: string[]): { includes: string[]; excludes: string[] } {
  if (!domainFilter?.length) return { includes: [], excludes: [] };
  const includes = domainFilter.filter((d) => !d.startsWith("-"));
  const excludes = domainFilter.filter((d) => d.startsWith("-")).map((d) => d.slice(1));
  return { includes, excludes };
}

function firecrawlSearchTbs(timeRange?: string): string | undefined {
  if (!timeRange || timeRange === "any") return undefined;
  const map: Record<string, string> = {
    day: "qdr:d",
    week: "qdr:w",
    month: "qdr:m",
    year: "qdr:y",
  };
  return map[timeRange];
}

function defaultFirecrawlVariant(providerId: string): FirecrawlSearchVariant {
  if (providerId === "firecrawl-search") {
    return {
      providerId,
      timeoutMs: 60_000,
      freeMonthlyQuota: 500,
      invalidUrlPolicy: "drop",
      citationProvider: providerId,
      aliasBody: { ignoreInvalidURLs: true, scrapeOptionsFromContent: true },
    };
  }

  return {
    providerId,
    invalidUrlPolicy: "preserve",
    citationProvider: providerId,
  };
}

function resolveFirecrawlBaseUrl(
  config: SearchProviderConfig,
  params: FirecrawlSearchParams
): string {
  let providerOverride = "";
  if (typeof params.providerOptions?.baseUrl === "string") {
    providerOverride = params.providerOptions.baseUrl.trim();
  } else if (typeof params.providerSpecificData?.baseUrl === "string") {
    providerOverride = params.providerSpecificData.baseUrl.trim();
  }
  const envBase = process.env.FIRECRAWL_BASE_URL?.trim() || "";
  const configuredBase = (envBase || providerOverride || config.baseUrl).replace(/\/+$/, "");
  return configuredBase.endsWith("/v2/search") ? configuredBase : `${configuredBase}/v2/search`;
}

export function buildFirecrawlSearchRequest(
  config: SearchProviderConfig,
  params: FirecrawlSearchParams,
  providedVariant?: FirecrawlSearchVariant
): { url: string; init: RequestInit } {
  const variant = providedVariant || defaultFirecrawlVariant(config.id);
  const url = resolveFirecrawlBaseUrl(config, params);
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const source = params.searchType === "news" ? "news" : "web";

  const body: Record<string, unknown> = {
    query: params.query,
    limit: params.maxResults,
    sources: [source],
  };
  if (params.country) body.country = params.country.toLowerCase();
  if (params.country && variant.providerId === "firecrawl-search") {
    body.country = params.country.toUpperCase();
  }
  if (params.language) body.lang = params.language;
  const tbs = firecrawlSearchTbs(params.timeRange);
  if (tbs) body.tbs = tbs;
  if (includes.length) body.includeDomains = includes.map((d) => d.toLowerCase());
  if (excludes.length) body.excludeDomains = excludes.map((d) => d.toLowerCase());
  if (variant.aliasBody?.ignoreInvalidURLs) body.ignoreInvalidURLs = true;
  if (variant.aliasBody?.scrapeOptionsFromContent) body.scrapeOptionsFromContent = true;
  if (params.contentOptions?.full_page) {
    body.scrapeOptions = {
      formats: [{ type: params.contentOptions.format === "markdown" ? "markdown" : "html" }],
    };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (params.token) {
    headers.Authorization = `Bearer ${params.token}`;
  }

  return {
    url,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  };
}

function pickFirecrawlSearchItems(
  data: FirecrawlSearchEnvelope,
  searchType: string
): FirecrawlSearchHit[] {
  const buckets = data?.data;
  if (!buckets || Array.isArray(buckets)) return [];
  const items = searchType === "news" ? buckets.news : buckets.web;
  return Array.isArray(items) ? items : [];
}

function firecrawlTextFormat(item: FirecrawlSearchHit): string | undefined {
  if (item.markdown) return "markdown";
  // SearchResult.content accepts text/markdown only; retain HTML payload as text
  // rather than emitting an invalid content format.
  if (item.html) return "text";
  if (item.content) return "text";
  return undefined;
}

function normalizeFirecrawlSourceType(category: string | undefined, searchType: string): string {
  const candidate = (category || searchType).trim().toLowerCase();
  // AICODE-NOTE: SearchResult.metadata.source_type is an enum; provider categories
  // such as "docs" and the web bucket name must not leak invalid values downstream.
  return FIRECRAWL_SOURCE_TYPES.has(candidate) ? candidate : "other";
}

export function collectFirecrawlSearchHits(
  data: FirecrawlSearchEnvelope,
  searchType: string
): FirecrawlNormalizedHit[] {
  const isNews = searchType === "news";
  return pickFirecrawlSearchItems(data, searchType).map((item) => ({
    title: item.title || item.metadata?.title || "",
    url: item.url || item.metadata?.sourceURL || item.link || "",
    snippet:
      item.description ||
      item.snippet ||
      item.markdown?.slice(0, 300) ||
      item.content?.slice(0, 300) ||
      "",
    published_at: item.date || item.published_at || item.metadata?.publishedTime || null,
    image_url: item.imageUrl || undefined,
    source_type: isNews ? "news" : undefined,
    category: item.category || undefined,
    full_text: item.markdown || item.html || item.content || undefined,
    text_format: firecrawlTextFormat(item),
  }));
}

export function normalizeFirecrawlSearchResponse<T>(
  data: FirecrawlSearchEnvelope,
  searchType: string,
  makeResult: (providerId: string, item: FirecrawlNormalizedHit, idx: number, now: string) => T,
  providedVariant?: FirecrawlSearchVariant
): { results: T[]; totalResults: number | null } {
  const variant = providedVariant || defaultFirecrawlVariant("firecrawl");
  const now = new Date().toISOString();
  const hits = collectFirecrawlSearchHits(data, searchType);
  const filteredHits =
    variant.invalidUrlPolicy === "drop"
      ? hits.filter((item) => {
          if (typeof item.url !== "string") return false;
          try {
            const parsed = new URL(item.url);
            return parsed.protocol === "http:" || parsed.protocol === "https:";
          } catch {
            return false;
          }
        })
      : hits;
  const citationProvider = variant.citationProvider || variant.providerId;
  const results = filteredHits.map((item, idx) => {
    const normalizedItem =
      variant.providerId === "firecrawl-search"
        ? { ...item, source_type: normalizeFirecrawlSourceType(item.category, searchType) }
        : item;
    return makeResult(citationProvider, normalizedItem, idx, now);
  });
  return { results, totalResults: results.length };
}
