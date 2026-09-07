import { randomUUID } from "crypto";
/**
 * Search Handler
 *
 * Handles POST /v1/search requests.
 * Routes to configured search providers with automatic failover:
 *   serper-search, brave-search, perplexity-search, exa-search, tavily-search,
 *   firecrawl, google-pse-search, linkup-search, searchapi-search, youcom-search,
 *   searxng-search, ollama-search, zai-search, parallel-search, firecrawl-search,
 *   gemini-grounded-search, duckduckgo-free
 *
 * Request format:
 * {
 *   "query": "search query",
 *   "provider": "serper-search" | "brave-search" | ... // optional, auto-selects cheapest
 *   "max_results": 5,
 *   "search_type": "web" | "news" | "x"
 * }
 */

import {
  getSearchProvider,
  isUnconfiguredLoopbackSearchProvider,
  type SearchProviderConfig,
} from "../config/searchRegistry.ts";
import { buildPerplexityRequest, parsePerplexitySearchOptions } from "./search/perplexitySearch.ts";
import * as fcSearch from "./search/firecrawlSearch.ts";
import type { FirecrawlSearchEnvelope } from "./search/firecrawlSearch.ts";
export {
  buildFirecrawlSearchRequest,
  normalizeFirecrawlSearchResponse,
} from "./search/firecrawlSearch.ts";
import { executeSearchOperation, executeSearchRequest } from "./search/searchProxy.ts";
import { freeWebSearch } from "../services/freeWebSearch.ts";
import { saveCallLog } from "@/lib/usageDb";
import { safeOutboundFetch } from "@/shared/network/safeOutboundFetch";
import { parseAndValidateNonMetadataUrl } from "@/shared/network/outboundUrlGuard";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { sanitizeErrorMessage } from "../utils/error.ts";
import { isValidContext7LibraryId } from "../executors/context7-fetch.ts";
import { resolveSearchProxy, executeProviderFetch } from "./search/searchProxy.ts";
import { formatSearchProviderFailure } from "./search/providerFailure.ts";

type SearchJsonObject = Record<string, unknown>;

interface SearchLogger {
  info?: (tag: string, message: string) => void;
  warn?: (tag: string, message: string) => void;
  error?: (tag: string, message: string) => void;
}

function asSearchObject(value: unknown): SearchJsonObject | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as SearchJsonObject;
}

function readSearchValue(value: unknown, key: string): unknown {
  return asSearchObject(value)?.[key];
}

function readSearchObject(value: unknown, key: string): SearchJsonObject | undefined {
  return asSearchObject(readSearchValue(value, key));
}

function readSearchArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readSearchString(value: unknown, key: string): string | undefined {
  const property = readSearchValue(value, key);
  return typeof property === "string" ? property : undefined;
}

function readSearchNumber(value: unknown, key: string): number | undefined {
  const property = readSearchValue(value, key);
  return typeof property === "number" ? property : undefined;
}

function firstSearchString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function readSearchStringArray(value: unknown, key: string): string[] {
  const values = readSearchArray(readSearchValue(value, key)) ?? [];
  return values.filter((item): item is string => typeof item === "string");
}

function getSearchErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = readSearchValue(error, "message");
  return typeof message === "string" ? message : String(error);
}

function getSearchErrorName(error: unknown): string | undefined {
  if (error instanceof Error) return error.name;
  const name = readSearchValue(error, "name");
  return typeof name === "string" ? name : undefined;
}

function resolveSearchConnectionId(
  credentials: SearchJsonObject,
  preferredId?: string | null
): string | null {
  if (preferredId) return preferredId;
  const connectionId = readSearchValue(credentials, "connectionId");
  if (typeof connectionId === "string") return connectionId;
  const id = readSearchValue(credentials, "id");
  return typeof id === "string" ? id : null;
}

export interface SearchResult {
  title: string;
  url: string;
  display_url?: string;
  snippet: string;
  position: number;
  score: number | null;
  published_at: string | null;
  favicon_url: string | null;
  content: { format: string; text: string; length: number } | null;
  metadata: {
    author: string | null;
    language: string | null;
    source_type: string | null;
    image_url: string | null;
  } | null;
  citation: {
    provider: string;
    retrieved_at: string;
    rank: number;
  };
  provider_raw: Record<string, unknown> | null;
}

export interface SearchResponse {
  provider: string;
  query: string;
  results: SearchResult[];
  answer: { source: string; text: string | null; model: string | null } | null;
  usage: { queries_used: number; search_cost_usd: number; llm_tokens?: number };
  metrics: {
    response_time_ms: number;
    upstream_latency_ms: number;
    gateway_latency_ms?: number;
    total_results_available: number | null;
  };
  errors: Array<{ provider: string; code: string; message: string }>;
}

interface SearchHandlerResult {
  success: boolean;
  status?: number;
  error?: string;
  data?: SearchResponse;
}

interface SearchHandlerOptions {
  query: string;
  provider: string;
  maxResults: number;
  searchType: string;
  country?: string;
  language?: string;
  timeRange?: string;
  offset?: number;
  domainFilter?: string[];
  contentOptions?: {
    snippet?: boolean;
    full_page?: boolean;
    format?: string;
    max_characters?: number;
  };
  strictFilters?: boolean;
  providerOptions?: Record<string, unknown>;
  credentials: SearchJsonObject;
  connectionId?: string | null;
  apiKeyId?: string | null;
  providerConfig?: SearchProviderConfig;
  alternateProvider?: string;
  alternateProviderConfig?: SearchProviderConfig | null;
  alternateCredentials?: SearchJsonObject | null;
  log?: SearchLogger;
}

// ── Constants ────────────────────────────────────────────────────────────

const GLOBAL_TIMEOUT_MS = 15_000;
const DEFAULT_GEMINI_GROUNDED_SEARCH_MODEL = "gemini-2.5-flash";

// Non-retriable HTTP status codes — fail immediately, don't try alternate
const NON_RETRIABLE = new Set([400, 401, 403, 404]);

// ── Input Sanitization ──────────────────────────────────────────────────

// Control characters that should never appear in search queries
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function sanitizeQuery(query: string): { clean: string; error?: string } {
  if (CONTROL_CHAR_RE.test(query)) {
    return { clean: "", error: "Query contains invalid control characters" };
  }
  const clean = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (clean.length === 0) {
    return { clean: "", error: "Query is empty after normalization" };
  }
  return { clean };
}

// ── Response Normalizers ────────────────────────────────────────────────

function makeResult(
  providerId: string,
  item: {
    title?: string;
    url?: string;
    snippet?: string;
    score?: number;
    published_at?: string | null;
    favicon_url?: string;
    author?: string;
    source_type?: string;
    image_url?: string;
    full_text?: string;
    text_format?: string;
  },
  idx: number,
  now: string
): SearchResult {
  const url = item.url || "";
  return {
    title: item.title || "",
    url,
    display_url: url ? url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0] : undefined,
    snippet: item.snippet || "",
    position: idx + 1,
    score: typeof item.score === "number" ? Math.min(1, Math.max(0, item.score)) : null,
    published_at: item.published_at || null,
    favicon_url: item.favicon_url || null,
    content: item.full_text
      ? { format: item.text_format || "text", text: item.full_text, length: item.full_text.length }
      : null,
    metadata: {
      author: item.author || null,
      language: null,
      source_type: item.source_type || null,
      image_url: item.image_url || null,
    },
    citation: { provider: providerId, retrieved_at: now, rank: idx + 1 },
    provider_raw: null,
  };
}

function isValidResultUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function joinStringArray(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join("\n\n")
    : "";
}

function normalizeUrlForDedupe(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.href;
}

function normalizeSerperResponse(
  data: unknown,
  _query: string,
  searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = readSearchArray(readSearchValue(data, searchType === "news" ? "news" : "organic"));
  if (!Array.isArray(items)) return { results: [], totalResults: null };

  const results = items.map((item, idx) =>
    makeResult(
      "serper-search",
      {
        title: readSearchString(item, "title"),
        url: readSearchString(item, "link"),
        snippet: firstSearchString(
          readSearchString(item, "snippet"),
          readSearchString(item, "description")
        ),
        published_at: readSearchString(item, "date"),
      },
      idx,
      now
    )
  );

  return {
    results,
    totalResults:
      readSearchNumber(readSearchObject(data, "searchParameters"), "totalResults") ?? null,
  };
}

// Context7 library-docs search results: { results: [{ id: "/owner/repo", title,
// description, lastUpdateDate, stars, trustScore, ... }] }. The API has no URL
// field — the library page URL is derived from the id. The relevance score is an
// unbounded float (observed ~276), not a 0..1 score, so it is not mapped onto the
// normalized 0..1 score field.
interface Context7SearchItem {
  id?: string;
  title?: string;
  description?: string;
  lastUpdateDate?: string;
}

function normalizeContext7Response(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = (data as { results?: Context7SearchItem[] } | null)?.results;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  // Only canonical library ids are usable: they are interpolated into a
  // context7.com URL, so anything else (missing, "//evil.com", ".." traversal,
  // query junk) is dropped instead of producing a misleading or off-site link.
  // Shared guard with the fetch executor (isValidContext7LibraryId) — no drift.
  const usable = items.filter((item): item is Context7SearchItem & { id: string } =>
    isValidContext7LibraryId(item?.id ?? "")
  );
  const results = usable.map((item, idx: number) =>
    makeResult(
      "context7",
      {
        title: item?.title,
        url: `https://context7.com${item.id}`,
        snippet: item?.description,
        published_at: item?.lastUpdateDate,
      },
      idx,
      now
    )
  );
  return { results, totalResults: null };
}

function normalizeBraveResponse(
  data: unknown,
  _query: string,
  searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  // Brave news endpoint returns { results: [...] } directly,
  // while web endpoint returns { web: { results: [...] } }
  const container =
    searchType === "news"
      ? (readSearchObject(data, "news") ?? asSearchObject(data))
      : readSearchObject(data, "web");
  const items = readSearchArray(readSearchValue(container, "results"));
  if (!Array.isArray(items)) return { results: [], totalResults: null };

  const results = items.map((item, idx) =>
    makeResult(
      "brave-search",
      {
        title: readSearchString(item, "title"),
        url: readSearchString(item, "url"),
        snippet: readSearchString(item, "description"),
        published_at: firstSearchString(
          readSearchString(item, "page_age"),
          readSearchString(item, "age")
        ),
        favicon_url: firstSearchString(
          readSearchString(readSearchObject(item, "meta_url"), "favicon"),
          readSearchString(item, "favicon")
        ),
      },
      idx,
      now
    )
  );

  return { results, totalResults: readSearchNumber(container, "totalCount") ?? null };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseDomainFilter(domainFilter?: string[]): {
  includes: string[];
  excludes: string[];
} {
  if (!domainFilter?.length) return { includes: [], excludes: [] };
  const includes = domainFilter.filter((d) => !d.startsWith("-"));
  const excludes = domainFilter.filter((d) => d.startsWith("-")).map((d) => d.slice(1));
  return { includes, excludes };
}

function getProviderSettingString(
  params: Pick<SearchRequestParams, "providerOptions" | "providerSpecificData">,
  key: string
): string | undefined {
  const fromOptions = params.providerOptions?.[key];
  if (typeof fromOptions === "string" && fromOptions.trim().length > 0) {
    return fromOptions.trim();
  }

  const fromProviderData = params.providerSpecificData?.[key];
  if (typeof fromProviderData === "string" && fromProviderData.trim().length > 0) {
    return fromProviderData.trim();
  }

  return undefined;
}

export function resolveSearchBaseUrl(
  config: SearchProviderConfig,
  params: SearchRequestParams
): string {
  const override = getProviderSettingString(params, "baseUrl");
  if (override) {
    // GHSA-j7j4-g9qc-q69c: the override is client-controlled (provider_options /
    // providerSpecificData) and flows into a plain fetch() sink — validate it
    // before any builder uses it as the server-side fetch target. Mode is
    // block-metadata (NOT public-only): the primary searxng use case is a
    // self-hosted instance on loopback/LAN, so private hosts keep working,
    // while cloud-metadata endpoints (IMDS credential theft) are rejected.
    // The catalog's own config.baseUrl is operator config and stays untouched.
    parseAndValidateNonMetadataUrl(override);
    return override.replace(/\/+$/, "");
  }
  return config.baseUrl.replace(/\/+$/, "");
}

function toSearchPageNumber(offset: number | undefined, maxResults: number): number | undefined {
  if (typeof offset !== "number" || offset <= 0 || maxResults <= 0) return undefined;
  return Math.floor(offset / maxResults) + 1;
}

function getGeminiGroundedSearchModel(params: SearchRequestParams): string {
  return (
    getProviderSettingString(params, "model") ||
    process.env.GEMINI_GROUNDED_SEARCH_MODEL ||
    DEFAULT_GEMINI_GROUNDED_SEARCH_MODEL
  );
}

function buildGeminiGroundedSearchPrompt(params: SearchRequestParams): string {
  const lines = [
    `Search the web for: ${params.query}`,
    "Use Google Search grounding. Return a concise answer based only on grounded sources.",
  ];
  if (params.country) lines.push(`Prefer sources relevant to country: ${params.country}.`);
  if (params.language) lines.push(`Prefer language: ${params.language}.`);
  if (params.timeRange && params.timeRange !== "any") {
    lines.push(`Prefer information from the last ${params.timeRange}.`);
  }
  return lines.join("\n");
}

// ── Provider Request Builders ───────────────────────────────────────────

interface SearchRequestParams {
  query: string;
  searchType: string;
  maxResults: number;
  token?: string;
  country?: string;
  language?: string;
  timeRange?: string;
  offset?: number;
  domainFilter?: string[];
  contentOptions?: {
    snippet?: boolean;
    full_page?: boolean;
    format?: string;
    max_characters?: number;
  };
  providerOptions?: Record<string, unknown>;
  providerSpecificData?: Record<string, unknown>;
}

function buildSerperRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const endpoint = params.searchType === "news" ? "/news" : "/search";
  const body: Record<string, unknown> = { q: params.query, num: params.maxResults };
  if (params.country) body.gl = params.country.toLowerCase();
  if (params.language) body.hl = params.language;
  return {
    url: `${config.baseUrl}${endpoint}`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { "X-API-Key": params.token } : {}),
      },
      body: JSON.stringify(body),
    },
  };
}

// Context7 library-docs search: GET {baseUrl}/search?query=<q>. Key optional —
// anonymous tier works without one; a configured ctx7sk-* key rides as Bearer.
function buildContext7Request(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const qp = new URLSearchParams({ query: params.query });
  return {
    url: `${config.baseUrl}/search?${qp}`,
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
      },
    },
  };
}

function buildBraveRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const endpoint = params.searchType === "news" ? "/news/search" : "/web/search";
  const qp = new URLSearchParams({ q: params.query, count: String(params.maxResults) });
  if (params.country) qp.set("country", params.country);
  if (params.language) qp.set("search_lang", params.language);
  return {
    url: `${config.baseUrl}${endpoint}?${qp}`,
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(params.token ? { "X-Subscription-Token": params.token } : {}),
      },
    },
  };
}

function buildExaRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const body: Record<string, unknown> = {
    query: params.query,
    numResults: params.maxResults,
    type: "auto",
    contents: {
      text: true,
      highlights: true,
    },
  };
  if (includes.length) body.includeDomains = includes;
  if (excludes.length) body.excludeDomains = excludes;
  if (params.searchType === "news") body.category = "news";
  return {
    url: config.baseUrl,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { "x-api-key": params.token } : {}),
      },
      body: JSON.stringify(body),
    },
  };
}

function buildTavilyRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const body: Record<string, unknown> = {
    query: params.query,
    max_results: params.maxResults,
    topic: params.searchType === "news" ? "news" : "general",
  };
  if (includes.length) body.include_domains = includes;
  if (excludes.length) body.exclude_domains = excludes;
  if (params.country) body.country = params.country;
  return {
    url: config.baseUrl,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.token}` },
      body: JSON.stringify(body),
    },
  };
}

function buildGooglePseRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const apiKey = params.token;
  const cx = getProviderSettingString(params, "cx");
  if (!apiKey || !cx) {
    throw new Error("Google Programmable Search requires both apiKey and cx");
  }

  const qp = new URLSearchParams({
    key: apiKey,
    cx,
    q: params.query,
    num: String(Math.min(params.maxResults, 10)),
  });

  if (params.country) qp.set("gl", params.country.toLowerCase());
  if (params.language) qp.set("hl", params.language);
  if (params.timeRange && params.timeRange !== "any") {
    const dateRestrictMap: Record<string, string> = {
      day: "d1",
      week: "w1",
      month: "m1",
      year: "y1",
    };
    const dateRestrict = dateRestrictMap[params.timeRange];
    if (dateRestrict) qp.set("dateRestrict", dateRestrict);
  }
  if (typeof params.offset === "number" && params.offset > 0) {
    qp.set("start", String(Math.min(params.offset + 1, 91)));
  }

  return {
    url: `${resolveSearchBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  };
}

function buildLinkupRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const apiKey = params.token;
  if (!apiKey) {
    throw new Error("Linkup Search requires an API key");
  }

  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const requestedDepth = getProviderSettingString(params, "depth");
  const depth =
    requestedDepth && ["fast", "standard", "deep"].includes(requestedDepth)
      ? requestedDepth
      : "standard";

  const body: Record<string, unknown> = {
    q: params.query,
    depth,
    outputType: "searchResults",
    maxResults: params.maxResults,
  };

  if (includes.length) body.includeDomains = includes;
  if (excludes.length) body.excludeDomains = excludes;
  if (params.timeRange && params.timeRange !== "any") {
    const today = new Date();
    const toDate = today.toISOString().slice(0, 10);
    const from = new Date(today);
    if (params.timeRange === "day") from.setUTCDate(from.getUTCDate() - 1);
    if (params.timeRange === "week") from.setUTCDate(from.getUTCDate() - 7);
    if (params.timeRange === "month") from.setUTCMonth(from.getUTCMonth() - 1);
    if (params.timeRange === "year") from.setUTCFullYear(from.getUTCFullYear() - 1);
    body.fromDate = from.toISOString().slice(0, 10);
    body.toDate = toDate;
  }

  return {
    url: resolveSearchBaseUrl(config, params),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  };
}

function buildSearchApiRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const apiKey = params.token;
  if (!apiKey) {
    throw new Error("SearchAPI requires an API key");
  }

  const qp = new URLSearchParams({
    engine: params.searchType === "news" ? "google_news" : "google",
    q: params.query,
    api_key: apiKey,
  });

  if (params.country) qp.set("gl", params.country.toLowerCase());
  if (params.language) qp.set("hl", params.language);

  const page = toSearchPageNumber(params.offset, params.maxResults);
  if (page) qp.set("page", String(page));

  return {
    url: `${resolveSearchBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  };
}

function buildYouComRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const apiKey = params.token;
  if (!apiKey) {
    throw new Error("You.com Search requires an API key");
  }

  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const qp = new URLSearchParams({
    query: params.query,
    count: String(Math.min(params.maxResults, 100)),
  });

  if (params.timeRange && params.timeRange !== "any") {
    qp.set("freshness", params.timeRange);
  }
  if (typeof params.offset === "number" && params.offset > 0 && params.maxResults > 0) {
    qp.set("offset", String(Math.min(Math.floor(params.offset / params.maxResults), 9)));
  }
  if (params.country) qp.set("country", params.country);
  if (params.language) qp.set("language", params.language);
  if (includes.length) qp.set("include_domains", includes.join(","));
  if (excludes.length) qp.set("exclude_domains", excludes.join(","));

  if (params.contentOptions?.full_page) {
    qp.set("livecrawl", params.searchType === "news" ? "news" : "web");
    qp.append(
      "livecrawl_formats",
      params.contentOptions.format === "markdown" ? "markdown" : "html"
    );
  }

  return {
    url: `${resolveSearchBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
      },
    },
  };
}

function buildSearxngRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const baseUrl = resolveSearchBaseUrl(config, params);
  const url = baseUrl.endsWith("/search") ? baseUrl : `${baseUrl}/search`;
  const qp = new URLSearchParams({
    q: params.query,
    format: "json",
    categories: params.searchType === "news" ? "news" : "general",
  });

  if (params.language) qp.set("language", params.language);
  if (params.timeRange && params.timeRange !== "any") qp.set("time_range", params.timeRange);

  const page = toSearchPageNumber(params.offset, params.maxResults);
  if (page) qp.set("pageno", String(page));

  const headers: Record<string, string> = { Accept: "application/json" };
  if (params.token) {
    headers["Authorization"] = `Bearer ${params.token}`;
  }

  return {
    url: `${url}?${qp}`,
    init: {
      method: "GET",
      headers,
    },
  };
}

function buildOllamaRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  return {
    url: resolveSearchBaseUrl(config, params),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
      },
      body: JSON.stringify({
        query: params.query,
        max_results: params.maxResults,
      }),
    },
  };
}

export function buildParallelSearchRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit } {
  const apiKey = params.token;
  if (!apiKey) {
    throw new Error("Parallel Search requires an API key");
  }

  return {
    url: resolveSearchBaseUrl(config, params),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        objective: params.query,
        search_queries: [params.query],
      }),
    },
  };
}

export function buildGeminiGroundedSearchRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): { url: string; init: RequestInit; model: string } {
  const apiKey = params.token;
  if (!apiKey) {
    throw new Error("Gemini Grounded Search requires an API key");
  }

  const model = getGeminiGroundedSearchModel(params);
  const baseUrl = resolveSearchBaseUrl(config, params);
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: buildGeminiGroundedSearchPrompt(params) }],
      },
    ],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0.2,
    },
  };

  return {
    url: `${baseUrl}/${encodeURIComponent(model)}:generateContent`,
    model,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    },
  };
}

type BuiltSearchRequest = { url: string; init: RequestInit; model?: string };

function buildRequest(
  config: SearchProviderConfig,
  params: SearchRequestParams
): BuiltSearchRequest {
  if (config.id === "serper-search") return buildSerperRequest(config, params);
  if (config.id === "brave-search") return buildBraveRequest(config, params);
  if (config.id === "perplexity-search") return buildPerplexityRequest(config, params);
  if (config.id === "exa-search") return buildExaRequest(config, params);
  if (config.id === "tavily-search") return buildTavilyRequest(config, params);
  if (config.id === "firecrawl" || config.id === "firecrawl-search") {
    return fcSearch.buildFirecrawlSearchRequest(config, params);
  }
  if (config.id === "google-pse-search") return buildGooglePseRequest(config, params);
  if (config.id === "linkup-search") return buildLinkupRequest(config, params);
  if (config.id === "searchapi-search") return buildSearchApiRequest(config, params);
  if (config.id === "youcom-search") return buildYouComRequest(config, params);
  if (config.id === "searxng-search") return buildSearxngRequest(config, params);
  if (config.id === "ollama-search") return buildOllamaRequest(config, params);
  if (config.id === "parallel-search") return buildParallelSearchRequest(config, params);
  if (config.id === "gemini-grounded-search")
    return buildGeminiGroundedSearchRequest(config, params);
  // Fallback for future providers: POST with bearer auth
  return {
    url: resolveSearchBaseUrl(config, params),
    init: {
      method: config.method,
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
      },
      body: JSON.stringify({
        query: params.query,
        max_results: params.maxResults,
        search_type: params.searchType,
      }),
    },
  };
}

function normalizePerplexityResponse(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = readSearchArray(readSearchValue(data, "results"));
  if (!Array.isArray(items)) return { results: [], totalResults: null };

  const results = items.map((item, idx) =>
    makeResult(
      "perplexity-search",
      {
        title: readSearchString(item, "title"),
        url: readSearchString(item, "url"),
        snippet: readSearchString(item, "snippet"),
        published_at: firstSearchString(
          readSearchString(item, "date"),
          readSearchString(item, "last_updated")
        ),
      },
      idx,
      now
    )
  );
  return { results, totalResults: results.length };
}

function normalizeExaResponse(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = readSearchArray(readSearchValue(data, "results"));
  if (!Array.isArray(items)) return { results: [], totalResults: null };

  const results = items.map((item, idx) => {
    const highlights = readSearchArray(readSearchValue(item, "highlights"));
    const firstHighlight = highlights?.find((value) => typeof value === "string");
    return makeResult(
      "exa-search",
      {
        title: readSearchString(item, "title"),
        url: readSearchString(item, "url"),
        snippet:
          firstSearchString(firstHighlight) || readSearchString(item, "text")?.slice(0, 300) || "",
        score: readSearchNumber(item, "score"),
        published_at: readSearchString(item, "publishedDate"),
        favicon_url: readSearchString(item, "favicon"),
        author: readSearchString(item, "author"),
        image_url: readSearchString(item, "image"),
        full_text: readSearchString(item, "text"),
        text_format: "text",
      },
      idx,
      now
    );
  });
  return { results, totalResults: results.length };
}

function normalizeTavilyResponse(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = readSearchArray(readSearchValue(data, "results"));
  if (!Array.isArray(items)) return { results: [], totalResults: null };

  const results = items.map((item, idx) =>
    makeResult(
      "tavily-search",
      {
        title: readSearchString(item, "title"),
        url: readSearchString(item, "url"),
        snippet: readSearchString(item, "content") || "",
        score: readSearchNumber(item, "score"),
        published_at: readSearchString(item, "published_date"),
        full_text: readSearchString(item, "raw_content"),
        text_format: "text",
      },
      idx,
      now
    )
  );
  return { results, totalResults: results.length };
}

function normalizeGooglePseResponse(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = readSearchArray(readSearchValue(data, "items")) ?? [];
  const results = items.map((item, idx) =>
    makeResult(
      "google-pse-search",
      {
        title: readSearchString(item, "title"),
        url: readSearchString(item, "link"),
        snippet: readSearchString(item, "snippet"),
        image_url: firstSearchString(
          readSearchString(
            readSearchArray(readSearchObject(item, "pagemap")?.cse_image)?.[0],
            "src"
          ),
          readSearchString(
            readSearchArray(readSearchObject(item, "pagemap")?.cse_thumbnail)?.[0],
            "src"
          ),
          readSearchString(
            readSearchArray(readSearchObject(item, "pagemap")?.metatags)?.[0],
            "og:image"
          )
        ),
      },
      idx,
      now
    )
  );

  const searchInformation = readSearchObject(data, "searchInformation");
  const queries = readSearchObject(data, "queries");
  const request = readSearchArray(readSearchValue(queries, "request"));
  const totalResultsRaw =
    readSearchValue(searchInformation, "totalResults") ??
    readSearchValue(request?.[0], "totalResults") ??
    null;
  const totalResults =
    typeof totalResultsRaw === "string"
      ? Number(totalResultsRaw)
      : typeof totalResultsRaw === "number"
        ? totalResultsRaw
        : null;

  return {
    results,
    totalResults: Number.isFinite(totalResults) ? totalResults : null,
  };
}

function normalizeLinkupResponse(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = readSearchArray(readSearchValue(data, "results")) ?? [];
  const results = items.map((item, idx) =>
    makeResult(
      "linkup-search",
      {
        title: firstSearchString(readSearchString(item, "name"), readSearchString(item, "title")),
        url: readSearchString(item, "url"),
        snippet:
          firstSearchString(readSearchString(item, "content"), readSearchString(item, "snippet")) ||
          "",
        source_type: readSearchString(item, "type") || "web",
        image_url: firstSearchString(
          readSearchString(item, "image_url"),
          readSearchString(item, "imageUrl")
        ),
        full_text: readSearchString(item, "content"),
        text_format: "text",
      },
      idx,
      now
    )
  );

  return { results, totalResults: results.length };
}

function normalizeSearchApiResponse(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items =
    readSearchArray(readSearchValue(data, "organic_results")) ??
    readSearchArray(readSearchValue(data, "top_stories")) ??
    [];

  const results = items.map((item, idx) =>
    makeResult(
      "searchapi-search",
      {
        title: readSearchString(item, "title"),
        url: readSearchString(item, "link"),
        snippet:
          firstSearchString(
            readSearchString(item, "snippet"),
            readSearchString(item, "description")
          ) || "",
        published_at: firstSearchString(
          readSearchString(item, "date"),
          readSearchString(item, "published_at")
        ),
        favicon_url: readSearchString(item, "favicon"),
        author: readSearchString(item, "source"),
        image_url: readSearchString(item, "thumbnail"),
      },
      idx,
      now
    )
  );

  const totalResultsRaw = readSearchValue(
    readSearchObject(data, "search_information"),
    "total_results"
  );
  const totalResults =
    typeof totalResultsRaw === "number"
      ? totalResultsRaw
      : typeof totalResultsRaw === "string"
        ? Number(totalResultsRaw)
        : null;

  return {
    results,
    totalResults: Number.isFinite(totalResults) ? totalResults : results.length,
  };
}

function normalizeYouComResponse(
  data: unknown,
  _query: string,
  searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const resultsContainer = readSearchObject(data, "results");
  const section =
    searchType === "news"
      ? readSearchArray(readSearchValue(resultsContainer, "news"))
      : readSearchArray(readSearchValue(resultsContainer, "web"));
  const items = section ?? [];

  const results = items.map((item, idx) => {
    const firstSnippet = readSearchStringArray(item, "snippets").find(
      (value) => typeof value === "string"
    );
    const markdown = readSearchString(item, "markdown");
    const html = readSearchString(item, "html");
    const livecrawlText = markdown ?? html;
    const livecrawlFormat = markdown !== undefined ? "markdown" : "html";

    return makeResult(
      "youcom-search",
      {
        title: readSearchString(item, "title"),
        url: readSearchString(item, "url"),
        snippet: firstSnippet ?? readSearchString(item, "description") ?? "",
        published_at: readSearchString(item, "page_age"),
        favicon_url: readSearchString(item, "favicon_url"),
        image_url: readSearchString(item, "thumbnail_url"),
        source_type: searchType,
        full_text: livecrawlText,
        text_format: livecrawlText ? livecrawlFormat : undefined,
      },
      idx,
      now
    );
  });

  return { results, totalResults: results.length };
}

function normalizeSearxngResponse(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = readSearchArray(readSearchValue(data, "results")) ?? [];

  const results = items.map((item, idx) => {
    const engines = readSearchArray(readSearchValue(item, "engines"));
    const sourceType = engines
      ? engines.filter((engine): engine is string => typeof engine === "string").join(", ")
      : firstSearchString(readSearchString(item, "engine"), readSearchString(item, "category"));
    return makeResult(
      "searxng-search",
      {
        title: readSearchString(item, "title"),
        url: readSearchString(item, "url"),
        snippet:
          firstSearchString(readSearchString(item, "content"), readSearchString(item, "snippet")) ||
          "",
        published_at: firstSearchString(
          readSearchString(item, "publishedDate"),
          readSearchString(item, "published_date")
        ),
        source_type: sourceType,
        image_url: firstSearchString(
          readSearchString(item, "thumbnail"),
          readSearchString(item, "img_src")
        ),
      },
      idx,
      now
    );
  });

  return { results, totalResults: results.length };
}

function normalizeOllamaResponse(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = readSearchArray(readSearchValue(data, "results")) ?? [];

  const results = items.map((item, idx) =>
    makeResult(
      "ollama-search",
      {
        title: readSearchString(item, "title"),
        url: readSearchString(item, "url"),
        snippet: readSearchString(item, "content") || "",
        full_text: readSearchString(item, "content"),
        text_format: "text",
      },
      idx,
      now
    )
  );

  return { results, totalResults: results.length };
}

export function normalizeParallelSearchResponse(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = readSearchArray(readSearchValue(data, "results")) ?? [];

  const results = items
    .filter((item) => isValidResultUrl(readSearchString(item, "url")))
    .map((item, idx) => {
      const excerpts = joinStringArray(readSearchValue(item, "excerpts"));
      return makeResult(
        "parallel-search",
        {
          title: readSearchString(item, "title"),
          url: readSearchString(item, "url"),
          snippet: excerpts || readSearchString(item, "snippet") || "",
          published_at: readSearchString(item, "publish_date"),
          full_text: excerpts || undefined,
          text_format: "text",
        },
        idx,
        now
      );
    });

  return { results, totalResults: results.length };
}

function extractGeminiAnswerText(data: unknown): string {
  const candidates = readSearchArray(readSearchValue(data, "candidates")) ?? [];
  return candidates
    .flatMap((candidate) => {
      const content = readSearchObject(candidate, "content");
      return readSearchArray(readSearchValue(content, "parts")) ?? [];
    })
    .map((part) => readSearchString(part, "text")?.trim() || "")
    .filter(Boolean)
    .join("\n\n");
}

function extractGeminiGroundingChunks(data: unknown): unknown[] {
  const candidates = readSearchArray(readSearchValue(data, "candidates")) ?? [];
  return candidates.flatMap((candidate) => {
    const groundingMetadata = readSearchObject(candidate, "groundingMetadata");
    return readSearchArray(readSearchValue(groundingMetadata, "groundingChunks")) ?? [];
  });
}

export function normalizeGeminiGroundedSearchResponse(
  data: unknown,
  _query: string,
  _searchType: string,
  model = DEFAULT_GEMINI_GROUNDED_SEARCH_MODEL
): {
  results: SearchResult[];
  totalResults: number | null;
  answer: SearchResponse["answer"];
} {
  const now = new Date().toISOString();
  const answerText = extractGeminiAnswerText(data);
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const chunk of extractGeminiGroundingChunks(data)) {
    const web = readSearchObject(chunk, "web");
    const uri = readSearchString(web, "uri");
    if (!isValidResultUrl(uri)) continue;

    const dedupeKey = normalizeUrlForDedupe(uri);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    results.push(
      makeResult(
        "gemini-grounded-search",
        {
          title: readSearchString(web, "title") || uri,
          url: uri,
          snippet: answerText,
          source_type: "web",
        },
        results.length,
        now
      )
    );
  }

  return {
    results,
    totalResults: results.length,
    answer: answerText ? { source: "gemini-grounded-search", text: answerText, model } : null,
  };
}

// ── Z.AI Coding Plan Search MCP Execution ───────────────────────────

// Schema for the Z.AI MCP web_search_prime tool result. Z.AI double-encodes
// the results array as a JSON string inside the MCP text content, so we
// safely unwrap it with a typed schema instead of `JSON.parse(parsed)`.
const ZaiSearchItemSchema = z
  .object({
    title: z.string().optional(),
    link: z.string().optional(),
    content: z.string().optional(),
    publish_date: z.string().optional(),
    icon: z.string().optional(),
    media: z.string().optional(),
  })
  .passthrough();

type ZaiSearchItem = z.infer<typeof ZaiSearchItemSchema>;

const ZaiSearchResultsSchema = z.array(ZaiSearchItemSchema);

/**
 * Unwrap the double-encoded JSON from a Z.AI MCP web_search_prime response.
 *
 * Quirk: the MCP server returns a text content block whose body is a JSON
 * string. That JSON string, once parsed, is itself another JSON string
 * containing the actual results array. We try a single parse first
 * (in case the upstream behavior ever changes), then a nested parse.
 * Both paths are validated through `ZaiSearchResultsSchema` so any shape
 * regression upstream lands in our error path instead of corrupting results.
 */
function unwrapZaiContent(rawText: string): ZaiSearchItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }

  // Direct array path (defensive, in case Z.AI stops double-encoding).
  const direct = ZaiSearchResultsSchema.safeParse(parsed);
  if (direct.success) return direct.data;

  // Documented Z.AI behavior: parsed is a JSON string of the results array.
  if (typeof parsed !== "string") return null;
  let inner: unknown;
  try {
    inner = JSON.parse(parsed);
  } catch {
    return null;
  }
  const validated = ZaiSearchResultsSchema.safeParse(inner);
  return validated.success ? validated.data : null;
}

async function zaiSearchExecute(params: {
  config: SearchProviderConfig;
  query: string;
  token: string;
  params: SearchRequestParams;
  signal?: AbortSignal;
}): Promise<{ results: SearchResult[]; totalResults: number | null }> {
  const baseUrl = resolveSearchBaseUrl(params.config, params.params);
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    fetch: safeOutboundFetch,
    requestInit: {
      headers: {
        Authorization: `Bearer ${params.token}`,
      },
    },
  });

  const client = new Client({ name: "omniroute-search", version: "1.0" }, { capabilities: {} });

  const { signal } = params;

  let abortHandler: (() => void) | undefined;
  if (signal) {
    if (signal.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    abortHandler = () => {
      client.close().catch(() => {});
    };
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  try {
    await client.connect(transport);

    if (signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    const args: Record<string, unknown> = {
      search_query: params.query,
    };

    const { includes } = parseDomainFilter(params.params.domainFilter);
    if (includes.length > 0) {
      args.search_domain_filter = includes.join(",");
    }

    const toolResult = await client.callTool({
      name: "web_search_prime",
      arguments: args,
    });

    const rawContent: unknown[] = Array.isArray(toolResult.content) ? toolResult.content : [];
    const rawText = rawContent
      .map((content) => asSearchObject(content))
      .filter(
        (content): content is SearchJsonObject => content !== undefined && content.type === "text"
      )
      .map((content) => (typeof content.text === "string" ? content.text : ""))
      .join("\n");

    if (!rawText.trim()) {
      return { results: [], totalResults: null };
    }

    const items = unwrapZaiContent(rawText);
    if (!items) {
      return { results: [], totalResults: null };
    }

    const now = new Date().toISOString();
    const results = items.map((item, idx) =>
      makeResult(
        "zai-search",
        {
          title: item.title,
          url: item.link,
          snippet: item.content || "",
          published_at: item.publish_date,
          favicon_url: item.icon,
          source_type: item.media,
        },
        idx,
        now
      )
    );
    return { results, totalResults: results.length };
  } finally {
    if (abortHandler && signal) {
      signal.removeEventListener("abort", abortHandler);
    }
    await client.close();
  }
}

async function tryZaiMCPProvider(
  config: SearchProviderConfig,
  params: Omit<SearchRequestParams, "token">,
  token: string,
  providerSpecificData: Record<string, unknown> | undefined,
  startTime: number,
  globalStartTime: number,
  log?: SearchLogger,
  connectionId?: string | null,
  apiKeyId?: string | null
): Promise<SearchHandlerResult> {
  const { query, searchType, maxResults } = params;

  const remainingGlobal = GLOBAL_TIMEOUT_MS - (Date.now() - globalStartTime);
  const timeout = Math.min(config.timeoutMs, Math.max(remainingGlobal, 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const normalized = await executeSearchOperation({
      providerId: config.id,
      connectionId,
      apiKeyId,
      url: resolveSearchBaseUrl(config, { ...params, providerSpecificData }),
      operation: () =>
        zaiSearchExecute({
          config,
          query,
          token,
          params: { ...params, token, providerSpecificData },
          signal: controller.signal,
        }),
    });
    clearTimeout(timer);

    const results = normalized.results.slice(0, maxResults);
    const duration = Date.now() - startTime;

    saveCallLog({
      method: config.method,
      path: "/v1/search",
      status: 200,
      model: config.id,
      provider: config.id,
      duration,
      requestType: "search",
      connectionId,
      apiKeyId,
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      requestBody: { query: query.slice(0, 200), search_type: searchType, max_results: maxResults },
      responseBody: { results_count: results.length, cached: false },
    }).catch(() => {
      /* non-critical — logging must not block search response */
    });

    return {
      success: true,
      data: {
        provider: config.id,
        query,
        results,
        answer: null,
        usage: { queries_used: 1, search_cost_usd: config.costPerQuery },
        metrics: {
          response_time_ms: duration,
          upstream_latency_ms: duration,
          total_results_available: normalized.totalResults,
        },
        errors: [],
      },
    };
  } catch (err: unknown) {
    clearTimeout(timer);

    const errorMessage = getSearchErrorMessage(err);
    const isTimeout = getSearchErrorName(err) === "AbortError";
    if (log) {
      log.error?.("SEARCH", `${config.id} MCP ${isTimeout ? "timeout" : "error"}: ${errorMessage}`);
    }

    saveCallLog({
      method: config.method,
      path: "/v1/search",
      status: isTimeout ? 504 : 502,
      model: config.id,
      provider: config.id,
      duration: Date.now() - startTime,
      requestType: "search",
      connectionId,
      apiKeyId,
      error: errorMessage,
      requestBody: { query: query.slice(0, 200), search_type: searchType, max_results: maxResults },
    }).catch(() => {
      /* non-critical — logging must not block search response */
    });

    return {
      success: false,
      status: isTimeout ? 504 : 502,
      error: `Search provider ${isTimeout ? "timeout" : "error"}: ${sanitizeErrorMessage(errorMessage)}`,
    };
  }
}

type FirecrawlSearchHit = NonNullable<NonNullable<FirecrawlSearchEnvelope["data"]>["web"]>[number];
type FirecrawlSearchMetadata = NonNullable<FirecrawlSearchHit["metadata"]>;

function toFirecrawlSearchEnvelope(data: unknown): FirecrawlSearchEnvelope {
  const payload = readSearchObject(data, "data");
  if (!payload) return {};

  const toHit = (value: unknown): FirecrawlSearchHit | undefined => {
    const hit = asSearchObject(value);
    if (!hit) return undefined;

    const metadataRecord = readSearchObject(hit, "metadata");
    const metadata: FirecrawlSearchMetadata | undefined = metadataRecord
      ? {
          title: readSearchString(metadataRecord, "title"),
          sourceURL: readSearchString(metadataRecord, "sourceURL"),
          publishedTime: readSearchString(metadataRecord, "publishedTime"),
        }
      : undefined;

    return {
      title: readSearchString(hit, "title"),
      url: readSearchString(hit, "url"),
      link: readSearchString(hit, "link"),
      description: readSearchString(hit, "description"),
      snippet: readSearchString(hit, "snippet"),
      markdown: readSearchString(hit, "markdown"),
      html: readSearchString(hit, "html"),
      content: readSearchString(hit, "content"),
      category: readSearchString(hit, "category"),
      date: readSearchString(hit, "date"),
      published_at: readSearchString(hit, "published_at"),
      imageUrl: readSearchString(hit, "imageUrl"),
      metadata,
    };
  };

  const toHits = (value: unknown): FirecrawlSearchHit[] =>
    (readSearchArray(value) ?? [])
      .map(toHit)
      .filter((hit): hit is FirecrawlSearchHit => hit !== undefined);

  return {
    data: {
      web: toHits(readSearchValue(payload, "web")),
      news: toHits(readSearchValue(payload, "news")),
    },
  };
}

function normalizeResponse(
  providerId: string,
  data: unknown,
  query: string,
  searchType: string,
  model?: string
): { results: SearchResult[]; totalResults: number | null; answer?: SearchResponse["answer"] } {
  if (providerId === "serper-search") return normalizeSerperResponse(data, query, searchType);
  if (providerId === "brave-search") return normalizeBraveResponse(data, query, searchType);
  if (providerId === "perplexity-search")
    return normalizePerplexityResponse(data, query, searchType);
  if (providerId === "exa-search") return normalizeExaResponse(data, query, searchType);
  if (providerId === "tavily-search") return normalizeTavilyResponse(data, query, searchType);
  if (providerId === "firecrawl" || providerId === "firecrawl-search")
    return fcSearch.normalizeFirecrawlSearchResponse(
      toFirecrawlSearchEnvelope(data),
      searchType,
      makeResult,
      {
        providerId,
        timeoutMs: providerId === "firecrawl-search" ? 60_000 : undefined,
        freeMonthlyQuota: providerId === "firecrawl-search" ? 500 : undefined,
        invalidUrlPolicy: providerId === "firecrawl-search" ? "drop" : "preserve",
        citationProvider: providerId,
        aliasBody:
          providerId === "firecrawl-search"
            ? { ignoreInvalidURLs: true, scrapeOptionsFromContent: true }
            : undefined,
      }
    );
  if (providerId === "google-pse-search")
    return normalizeGooglePseResponse(data, query, searchType);
  if (providerId === "linkup-search") return normalizeLinkupResponse(data, query, searchType);
  if (providerId === "searchapi-search") return normalizeSearchApiResponse(data, query, searchType);
  if (providerId === "youcom-search") return normalizeYouComResponse(data, query, searchType);
  if (providerId === "searxng-search") return normalizeSearxngResponse(data, query, searchType);
  if (providerId === "ollama-search") return normalizeOllamaResponse(data, query, searchType);
  if (providerId === "parallel-search")
    return normalizeParallelSearchResponse(data, query, searchType);
  if (providerId === "gemini-grounded-search")
    return normalizeGeminiGroundedSearchResponse(data, query, searchType, model);
  return { results: [], totalResults: null };
}

function normalizeXSearchResponse(
  data: unknown,
  query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const hits = xSearch.extractXSearchHits(data, query, 20);
  const results = hits.map((hit, idx) =>
    makeResult(
      "x-search",
      {
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
        author: hit.author,
        source_type: "x",
      },
      idx,
      now
    )
  );
  return { results, totalResults: results.length };
}

function normalizeJinaSearchResponse(
  data: unknown,
  _query: string,
  _searchType: string
): { results: SearchResult[]; totalResults: number | null } {
  const now = new Date().toISOString();
  const items = extractJinaSearchItems(data);
  const results = items.map((item, idx) =>
    makeResult(
      "jina-search",
      {
        title: item.title,
        url: item.url,
        snippet: item.description || item.snippet || "",
        full_text: item.content || item.text,
        text_format: "markdown",
      },
      idx,
      now
    )
  );
  return { results, totalResults: results.length };
}

export async function handleSearch(options: SearchHandlerOptions): Promise<SearchHandlerResult> {
  const {
    query,
    provider: providerId,
    maxResults,
    searchType,
    country,
    language,
    timeRange,
    offset,
    domainFilter,
    contentOptions,
    providerOptions,
    credentials,
    connectionId,
    apiKeyId,
    providerConfig,
    alternateProvider,
    alternateProviderConfig,
    alternateCredentials,
    log,
    connectionId,
    apiKeyId,
  } = options;
  const startTime = Date.now();

  // 1. Sanitize input
  const { clean: cleanQuery, error: sanitizeError } = sanitizeQuery(query);
  if (sanitizeError) {
    return { success: false, status: 400, error: sanitizeError };
  }

  // 2. Use resolved provider from route (no re-resolution)
  const primaryConfig = providerConfig ?? getSearchProvider(providerId);
  if (!primaryConfig) {
    return {
      success: false,
      status: 400,
      error: `Unknown search provider: ${providerId}`,
    };
  }
  if (primaryConfig.disabled) {
    return {
      success: false,
      status: 403,
      error: `Search provider '${providerId}' is currently disabled.`,
    };
  }

  // 3. Get alternate config for failover (pre-resolved by route)
  const alternateConfig =
    alternateProviderConfig ?? (alternateProvider ? getSearchProvider(alternateProvider) : null);

  const requestParams = {
    query: cleanQuery,
    searchType,
    maxResults,
    country,
    language,
    timeRange,
    offset,
    domainFilter,
    contentOptions,
    providerOptions,
  };

  if (primaryConfig.id === "perplexity-search") {
    const perplexityValidation = parsePerplexitySearchOptions(requestParams);
    if (perplexityValidation.error) {
      return { success: false, status: 400, error: perplexityValidation.error };
    }
  }

  // 4. Try primary provider
  const result = await tryProvider(
    primaryConfig,
    requestParams,
    credentials,
    startTime,
    log,
    connectionId,
    apiKeyId
  );

  if (result.success && (result.data?.results.length || !alternateConfig)) return result;

  // 5. Failover to alternate (only for retriable errors and auto-select mode)
  if (
    alternateConfig &&
    alternateCredentials &&
    (result.success || !NON_RETRIABLE.has(result.status || 0)) &&
    Date.now() - startTime < GLOBAL_TIMEOUT_MS
  ) {
    if (log) {
      const reason = result.success ? "returned no usable results" : `failed (${result.status})`;
      log.warn?.("SEARCH", `${primaryConfig.id} ${reason}, trying ${alternateConfig.id}`);
    }

    // Resolve alternate connection proxy independently so primary context never leaks
    const fallbackResult = await tryProvider(
      alternateConfig,
      requestParams,
      alternateCredentials,
      startTime,
      log,
      resolveSearchConnectionId(alternateCredentials),
      apiKeyId
    );

    if (fallbackResult.success) return fallbackResult;
  }

  return result;
}

/**
 * Free DuckDuckGo lite provider — no API key, HTML scraping (free-claude-code port).
 * Dedicated path because the lite endpoint returns HTML, not the JSON the generic
 * tryProvider() flow expects. See open-sse/services/freeWebSearch.ts.
 */
async function tryDuckDuckGoFreeProvider(
  config: SearchProviderConfig,
  params: Omit<SearchRequestParams, "token">,
  startTime: number,
  globalStartTime: number,
  log?: {
    info?: (tag: string, message: string) => void;
    error?: (tag: string, message: string) => void;
  } | null,
  connectionId?: string | null,
  apiKeyId?: string | null
): Promise<SearchHandlerResult> {
  const { query, searchType, maxResults } = params;
  const remainingGlobal = GLOBAL_TIMEOUT_MS - (Date.now() - globalStartTime);
  const timeout = Math.min(config.timeoutMs, Math.max(remainingGlobal, 1000));

  if (log) {
    log.info?.("SEARCH", `${config.id} | query: "${query.slice(0, 80)}" | type: ${searchType}`);
  }

  const requestBody = {
    query: query.slice(0, 200),
    search_type: searchType,
    max_results: maxResults,
  };

  try {
    const freeResults = await executeSearchOperation({
      providerId: config.id,
      connectionId,
      apiKeyId,
      url: config.baseUrl,
      operation: () => freeWebSearch(query, maxResults, timeout),
    });
    const now = new Date().toISOString();
    const results = freeResults
      .slice(0, maxResults)
      .map((r, idx) =>
        makeResult(config.id, { title: r.title, url: r.url, snippet: r.snippet }, idx, now)
      );
    const duration = Date.now() - startTime;

    saveCallLog({
      method: config.method,
      path: "/v1/search",
      status: 200,
      model: config.id,
      provider: config.id,
      duration,
      requestType: "search",
      connectionId,
      apiKeyId,
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      requestBody,
      responseBody: { results_count: results.length, cached: false },
    }).catch(() => {
      /* non-critical — logging must not block search response */
    });

    return {
      success: true,
      data: {
        provider: config.id,
        query,
        results,
        answer: null,
        usage: { queries_used: 1, search_cost_usd: 0 },
        metrics: {
          response_time_ms: duration,
          upstream_latency_ms: duration,
          total_results_available: results.length,
        },
        errors: [],
      },
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const message = sanitizeErrorMessage(err);
    if (log) {
      log.error?.("SEARCH", `${config.id} error: ${message}`);
    }

    saveCallLog({
      method: config.method,
      path: "/v1/search",
      status: 502,
      model: config.id,
      provider: config.id,
      duration,
      requestType: "search",
      connectionId,
      apiKeyId,
      error: message.slice(0, 500),
      requestBody,
    }).catch(() => {
      /* non-critical */
    });

    return {
      success: false,
      status: 502,
      error: `DuckDuckGo free search failed: ${message}`,
    };
  }
}

async function tryProvider(
  config: SearchProviderConfig,
  params: Omit<SearchRequestParams, "token">,
  credentials: SearchJsonObject,
  globalStartTime: number,
  log?: SearchLogger,
  connectionId?: string | null,
  apiKeyId?: string | null
): Promise<SearchHandlerResult> {
  const startTime = Date.now();
  const providerSpecificData = asSearchObject(readSearchValue(credentials, "providerSpecificData"));
  const token = firstSearchString(
    readSearchValue(credentials, "apiKey"),
    readSearchValue(credentials, "accessToken")
  );
  const selectedConnectionId = resolveSearchConnectionId(credentials, connectionId);

  if (config.authType !== "none" && !token) {
    return {
      success: false,
      status: 401,
      error: `No credentials for search provider: ${config.id}`,
    };
  }

  const { query, searchType, maxResults } = params;

  if (config.id === "duckduckgo-free") {
    return tryDuckDuckGoFreeProvider(
      config,
      params,
      startTime,
      globalStartTime,
      log,
      selectedConnectionId,
      apiKeyId
    );
  }

  if (config.id === "zai-search" && token) {
    return tryZaiMCPProvider(
      config,
      params,
      token,
      providerSpecificData,
      startTime,
      globalStartTime,
      log,
      selectedConnectionId,
      apiKeyId
    );
  }

  let url = "";
  let init: RequestInit = {};
  let requestModel: string | undefined;
  try {
    const builtRequest = buildRequest(config, { ...params, token, providerSpecificData });
    url = builtRequest.url;
    init = builtRequest.init;
    requestModel = "model" in builtRequest ? builtRequest.model : undefined;
  } catch (err: unknown) {
    const errorMessage = getSearchErrorMessage(err);
    return {
      success: false,
      status: 400,
      error: errorMessage || `Invalid search configuration for provider: ${config.id}`,
    };
  }

  // Resolve proxy for the selected connection (see search/searchProxy.ts for the
  // resolveProxyForConnection precedence chain: per-key, account, provider, combo, global).
  const { proxy, proxyLevel } = await resolveSearchProxy(connectionId, apiKeyId, config.id);

  // Timeout: min of provider timeout and remaining global timeout
  const remainingGlobal = GLOBAL_TIMEOUT_MS - (Date.now() - globalStartTime);
  const timeout = Math.min(config.timeoutMs, Math.max(remainingGlobal, 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  if (log) {
    log.info?.("SEARCH", `${config.id} | query: "${query.slice(0, 80)}" | type: ${searchType}`);
  }

  try {
    const proxyRequest = await executeSearchRequest({
      providerId: config.id,
      connectionId: selectedConnectionId,
      apiKeyId,
      url,
      init: { ...init, signal: controller.signal },
    });
    const response = proxyRequest.response;
    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      if (log) {
        log.error?.("SEARCH", `${config.id} error ${response.status}: ${errorText.slice(0, 200)}`);
      }

      saveCallLog({
        method: config.method,
        path: "/v1/search",
        status: response.status,
        model: config.id,
        provider: config.id,
        duration: Date.now() - startTime,
        requestType: "search",
        connectionId: selectedConnectionId,
        apiKeyId,
        error: errorText.slice(0, 500),
        requestBody: {
          query: query.slice(0, 200),
          search_type: searchType,
          max_results: maxResults,
        },
      }).catch(() => {
        /* non-critical — logging must not block search response */
      });

      return {
        success: false,
        status: response.status,
        error: `Search provider ${config.id} returned ${response.status}`,
      };
    }

    const data: unknown = await response.json();
    const normalized = normalizeResponse(config.id, data, query, searchType, requestModel);
    // Enforce max_results — some providers return more than requested
    const results = normalized.results.slice(0, maxResults);
    const totalResults = normalized.totalResults;
    const duration = Date.now() - startTime;

    saveCallLog({
      method: config.method,
      path: "/v1/search",
      status: 200,
      model: config.id,
      provider: config.id,
      duration,
      requestType: "search",
      connectionId: selectedConnectionId,
      apiKeyId,
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      requestBody: { query: query.slice(0, 200), search_type: searchType, max_results: maxResults },
      responseBody: { results_count: results.length, cached: false },
    }).catch(() => {
      /* non-critical — logging must not block search response */
    });

    return {
      success: true,
      data: {
        provider: config.id,
        query,
        results,
        answer: normalized.answer ?? null,
        usage: { queries_used: 1, search_cost_usd: config.costPerQuery },
        metrics: {
          response_time_ms: duration,
          upstream_latency_ms: duration,
          total_results_available: totalResults,
        },
        errors: [],
      },
    };
  } catch (err: unknown) {
    clearTimeout(timer);

    const errorMessage = getSearchErrorMessage(err);
    const isTimeout = getSearchErrorName(err) === "AbortError";
    if (log) {
      log.error?.(
        "SEARCH",
        `${config.id} ${isTimeout ? "timeout" : "fetch error"}: ${errorMessage}`
      );
    }

    saveCallLog({
      method: config.method,
      path: "/v1/search",
      status: isTimeout ? 504 : 502,
      model: config.id,
      provider: config.id,
      duration: Date.now() - startTime,
      requestType: "search",
      connectionId: selectedConnectionId,
      apiKeyId,
      error: errorMessage,
      requestBody: { query: query.slice(0, 200), search_type: searchType, max_results: maxResults },
    }).catch(() => {
      /* non-critical — logging must not block search response */
    });

    return {
      success: false,
      status: isTimeout ? 504 : 502,
      error: `Search provider ${isTimeout ? "timeout" : "error"}: ${sanitizeErrorMessage(errorMessage)}`,
    };
  }
}
