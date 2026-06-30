/**
 * Fork-specific search routing orchestration for `/v1/search`.
 *
 * Extracted from `src/app/api/v1/search/route.ts` so the route stays a thin
 * upstream-shaped shell (parse → validate → policy → cache → respond) and the
 * Hermes configured-order + health-aware fallback logic lives in one fork-owned
 * module. This keeps the upstream `route.ts` diff small and conflict-friendly
 * when pulling updates from the original OmniRoute repo.
 */
import { handleSearch } from "@omniroute/open-sse/handlers/search.ts";
import type { SearchResponse } from "@omniroute/open-sse/handlers/search.ts";
import {
  getAutoSearchProviders,
  getSearchProvider,
  supportsSearchType,
  SEARCH_PROVIDERS,
  SEARCH_CREDENTIAL_FALLBACKS,
  type SearchProviderConfig,
} from "@omniroute/open-sse/config/searchRegistry.ts";
import { getProviderCredentials } from "@/sse/services/auth";
import {
  isAllRateLimitedCredentials,
  type RateLimitedCredentials,
} from "@/app/api/v1/_shared/rateLimit";
import { resolveEffectiveProviderOrder } from "@/lib/routing/routingOverrides";

type SearchCredentials = Record<string, any>;
type SearchCredentialLookup = SearchCredentials | RateLimitedCredentials | null;

export type SearchAttempt = {
  config: SearchProviderConfig;
  credentials: Record<string, any>;
};

export class SearchError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Request fields consumed by the search chain (subset of the validated body). */
export interface SearchChainRequest {
  query: string;
  provider?: string;
  search_type: string;
  max_results: number;
  country?: string;
  language?: string;
  time_range?: string;
  offset?: number;
  filters?: { include_domains?: string[]; exclude_domains?: string[] };
  content?: { snippet?: boolean; full_page?: boolean; format?: string; max_characters?: number };
  strict_filters?: boolean;
  provider_options?: Record<string, unknown>;
}

export type SearchLogger = {
  warn(tag: string, message: string): void;
};

const FALLBACKABLE_SEARCH_STATUSES = new Set([401, 403, 408, 429, 502, 503, 504]);

export function isFallbackableSearchStatus(status: number | undefined): boolean {
  if (!status) return true;
  return FALLBACKABLE_SEARCH_STATUSES.has(status) || status >= 500;
}

async function buildSearchProviderChain(
  provider: string | undefined,
  searchType: string
): Promise<string[]> {
  if (!provider) {
    return await resolveEffectiveProviderOrder(
      "search",
      getAutoSearchProviders().map((p) => p.id),
      (id) => supportsSearchType(id, searchType)
    );
  }
  return [provider];
}

async function resolveSearchCredentials(providerId: string): Promise<SearchCredentialLookup> {
  const credentials = await getProviderCredentials(providerId).catch(() => null);
  if (credentials && !isAllRateLimitedCredentials(credentials)) return credentials;

  const fallbackId = SEARCH_CREDENTIAL_FALLBACKS[providerId];
  if (!fallbackId) return credentials;

  const fallbackCredentials = await getProviderCredentials(fallbackId).catch(() => null);
  if (fallbackCredentials && !isAllRateLimitedCredentials(fallbackCredentials)) {
    return fallbackCredentials;
  }

  if (providerId === "parallel-search" && process.env.PARALLEL_API_KEY) {
    return { apiKey: process.env.PARALLEL_API_KEY };
  }

  return fallbackCredentials || credentials;
}

async function resolveSearchExecutionCredentials(providerConfig: {
  id: string;
  authType: string;
}): Promise<SearchCredentialLookup> {
  const credentials = await resolveSearchCredentials(providerConfig.id);
  if (credentials) return credentials;
  return providerConfig.authType === "none" ? {} : null;
}

function buildDomainFilter(filters?: {
  include_domains?: string[];
  exclude_domains?: string[];
}): string[] | undefined {
  if (!filters) return undefined;
  const parts: string[] = [];
  if (filters.include_domains?.length) parts.push(...filters.include_domains);
  if (filters.exclude_domains?.length) parts.push(...filters.exclude_domains.map((d) => `-${d}`));
  return parts.length > 0 ? parts : undefined;
}

/**
 * Result of resolving provider attempts. Flat (non-discriminated) shape on
 * purpose: this repo compiles with `strict: false` (no `strictNullChecks`), so
 * discriminated-union narrowing on a boolean flag does not work — the caller
 * checks the optional fields directly instead.
 */
export interface BuildAttemptsResult {
  attempts?: SearchAttempt[];
  errorStatus?: number;
  errorMessage?: string;
  rateLimited?: { providerId: string; credentials: RateLimitedCredentials };
}

/**
 * Resolve the ordered list of provider attempts (configured priority order for
 * auto-routing, or the single explicit provider) with credentials resolved and
 * unavailable providers filtered out.
 */
export async function buildSearchAttempts(
  body: Pick<SearchChainRequest, "provider" | "search_type">
): Promise<BuildAttemptsResult> {
  if (body.provider) {
    const explicitProvider = getSearchProvider(body.provider);
    if (!explicitProvider) {
      return { errorStatus: 400, errorMessage: `Unknown search provider: ${body.provider}` };
    }
    if (!supportsSearchType(explicitProvider, body.search_type)) {
      return {
        errorStatus: 400,
        errorMessage: `Search provider ${body.provider} does not support search_type: ${body.search_type}`,
      };
    }
  }

  const providerChain = await buildSearchProviderChain(body.provider, body.search_type);
  if (providerChain.length === 0) {
    return { errorStatus: 400, errorMessage: "No search providers available" };
  }

  const attempts: SearchAttempt[] = [];
  let firstRateLimited: { providerId: string; credentials: RateLimitedCredentials } | null = null;

  for (const providerId of providerChain) {
    const config = getSearchProvider(providerId);
    if (!config || !supportsSearchType(config, body.search_type)) continue;

    const resolvedCredentials = await resolveSearchExecutionCredentials(config);
    if (isAllRateLimitedCredentials(resolvedCredentials)) {
      firstRateLimited ??= {
        providerId: config.id,
        credentials: resolvedCredentials as RateLimitedCredentials,
      };
      continue;
    }
    if (!resolvedCredentials) {
      if (body.provider && providerId === body.provider) {
        return {
          errorStatus: 400,
          errorMessage: `No credentials configured for search provider: ${config.id}. Add an API key for "${config.id}" in the dashboard.`,
        };
      }
      continue;
    }

    attempts.push({ config, credentials: resolvedCredentials });
  }

  if (!body.provider && attempts.length === 0) {
    for (const config of Object.values(SEARCH_PROVIDERS)) {
      if (!config.fallbackOnly || !supportsSearchType(config, body.search_type)) continue;

      const resolvedCredentials = await resolveSearchExecutionCredentials(config);
      if (resolvedCredentials && !isAllRateLimitedCredentials(resolvedCredentials)) {
        attempts.push({ config, credentials: resolvedCredentials });
        break;
      }
    }
  }

  if (attempts.length === 0) {
    if (firstRateLimited) {
      return { rateLimited: firstRateLimited };
    }
    return {
      errorStatus: 400,
      errorMessage: body.provider
        ? `No credentials configured for search provider: ${body.provider}. Add an API key for "${body.provider}" in the dashboard.`
        : `No credentials configured for any search provider. Add an API key for a search provider (${Object.keys(
            SEARCH_PROVIDERS
          ).join(", ")}) in the dashboard.`,
    };
  }

  return { attempts };
}

/**
 * Execute the resolved provider attempts in order, falling back to the next
 * provider on retryable failures or empty usable results. Throws `SearchError`
 * when every attempt is exhausted.
 */
export async function runSearchChain(
  attempts: SearchAttempt[],
  body: SearchChainRequest,
  logger: SearchLogger
): Promise<SearchResponse> {
  let lastError: { message: string; status: number } | null = null;

  for (const [index, attempt] of attempts.entries()) {
    const result = await handleSearch({
      query: body.query,
      provider: attempt.config.id,
      maxResults: Math.min(body.max_results, attempt.config.maxMaxResults),
      searchType: body.search_type,
      country: body.country,
      language: body.language,
      timeRange: body.time_range,
      offset: body.offset,
      domainFilter: buildDomainFilter(body.filters),
      contentOptions: body.content,
      strictFilters: body.strict_filters,
      providerOptions: body.provider_options,
      credentials: attempt.credentials,
      log: logger,
    });

    const hasMoreAttempts = index < attempts.length - 1;
    if (result.success) {
      if (result.data?.results.length || !hasMoreAttempts) return result.data!;
      logger.warn(
        "SEARCH",
        `${attempt.config.id} returned no usable results, trying ${attempts[index + 1].config.id}`
      );
      continue;
    }

    lastError = { message: result.error || "Search failed", status: result.status || 502 };
    if (!hasMoreAttempts || !isFallbackableSearchStatus(result.status)) {
      throw new SearchError(lastError.message, lastError.status);
    }

    logger.warn(
      "SEARCH",
      `${attempt.config.id} failed (${result.status}), trying ${attempts[index + 1].config.id}`
    );
  }

  throw new SearchError(lastError?.message || "Search failed", lastError?.status || 502);
}
