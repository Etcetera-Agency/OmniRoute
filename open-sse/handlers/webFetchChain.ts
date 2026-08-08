/**
 * Fork-specific web-fetch routing orchestration.
 *
 * Extracted from `webFetch.ts` so the upstream-shaped handler stays a thin
 * wrapper (`handleWebFetch` → `runWebFetchChain`) and the Hermes sequential
 * provider chain + capability filtering + health-aware fallback lives in one
 * fork-owned module. This keeps the `webFetch.ts` diff vs upstream OmniRoute
 * tiny (types + a one-line delegation) and easy to reconcile on upstream pulls.
 */
import { buildErrorBody, sanitizeErrorMessage } from "../utils/error.ts";
import {
  WEB_FETCH_PROVIDER_ORDER,
  getWebFetchProvider,
  type WebFetchProviderId,
} from "../config/webFetchRegistry.ts";
import { tavilyFetch } from "../executors/tavily-fetch.ts";
import { firecrawlFetch } from "../executors/firecrawl-fetch.ts";
import { jinaReaderFetch } from "../executors/jina-reader-fetch.ts";
import { mdreamFetch } from "../executors/mdream-fetch.ts";
import { parallelExtractFetch } from "../executors/parallel-extract.ts";
import { tinyfishFetch } from "../executors/tinyfish-fetch.ts";
import { resolveEffectiveProviderOrder } from "@/lib/routing/routingOverrides";
import type {
  WebFetchCredentials,
  WebFetchFormat,
  WebFetchRequest,
  WebFetchResult,
} from "./webFetch.ts";

/**
 * Execute a web fetch request against the resolved provider chain, falling back
 * to the next compatible provider on retryable failures or empty content.
 */
export async function runWebFetchChain(
  req: WebFetchRequest,
  credentials: WebFetchCredentials,
  resolvedProvider?: WebFetchProviderId
): Promise<WebFetchResult> {
  const format: WebFetchFormat = req.format ?? "markdown";
  const includeMetadata = req.include_metadata ?? false;
  const explicitProvider = resolvedProvider ?? req.provider;
  const isExplicit = Boolean(explicitProvider);
  const providerChain = await buildProviderChain(explicitProvider, req.fallback ?? false);
  const compatibleProviders = providerChain.filter((provider) =>
    isProviderCompatible(provider, req)
  );
  const providers = compatibleProviders.length > 0 ? compatibleProviders : providerChain;

  let lastResult: WebFetchResult | null = null;
  let lastProvider: WebFetchProviderId | null = null;
  let firstRateLimited: { provider: WebFetchProviderId; credentials: WebFetchCredentials } | null =
    null;
  let attemptedProvider = false;
  // AICODE-NOTE: A preflight descriptor is a routing signal, never executor
  // input. Keep first blocked metadata so an exhausted automatic pool returns
  // one retryable response instead of a misleading missing-key 400.
  for (const provider of providers) {
    const providerCredentials = resolveProviderCredentials(provider, credentials);
    if (!providerCredentials) continue;
    if (isRateLimitedCredentials(providerCredentials)) {
      firstRateLimited ??= { provider, credentials: providerCredentials };
      if (isExplicit && !req.fallback) {
        return rateLimitedResult(provider, providerCredentials);
      }
      continue;
    }

    attemptedProvider = true;
    const startedAt = Date.now();
    const result = await tryWebFetchProvider(
      provider,
      req,
      providerCredentials,
      format,
      includeMetadata
    );
    logProviderAttempt(req, provider, result, format, Date.now() - startedAt);
    if (result.success) return result;
    lastResult = result;
    lastProvider = provider;
    if (!shouldTryNextProvider(provider, result) || (isExplicit && !req.fallback)) {
      return isRetryableQuotaStatus(provider, result.status)
        ? withDefaultRetryAfter(result)
        : result;
    }
  }

  if (firstRateLimited && (!lastResult || isRetryableQuotaResult(lastProvider, lastResult))) {
    return rateLimitedResult(firstRateLimited.provider, firstRateLimited.credentials, lastResult);
  }

  if (lastResult && isRetryableQuotaResult(lastProvider, lastResult)) {
    if (!isExplicit || req.fallback) {
      return rateLimitedResult(lastProvider ?? "mdream", {}, lastResult);
    }
    return withDefaultRetryAfter(lastResult);
  }

  return (
    lastResult ?? {
      success: false,
      status: attemptedProvider ? 502 : 400,
      error: attemptedProvider
        ? "No compatible web fetch provider available"
        : "No credentials configured for any compatible web-fetch provider",
    }
  );
}

async function buildProviderChain(
  explicitProvider: WebFetchProviderId | undefined,
  fallback: boolean
): Promise<WebFetchProviderId[]> {
  const effectiveOrder = (await resolveEffectiveProviderOrder(
    "fetch",
    WEB_FETCH_PROVIDER_ORDER
  )) as WebFetchProviderId[];
  if (!explicitProvider) return effectiveOrder;
  if (!fallback) return [explicitProvider];

  const startIndex = effectiveOrder.indexOf(explicitProvider);
  const afterExplicit =
    startIndex >= 0
      ? effectiveOrder.slice(startIndex + 1)
      : effectiveOrder.filter((provider) => provider !== explicitProvider);
  return [explicitProvider, ...afterExplicit.filter((provider) => provider !== explicitProvider)];
}

function logProviderAttempt(
  req: WebFetchRequest,
  provider: WebFetchProviderId,
  result: WebFetchResult,
  format: WebFetchFormat,
  latencyMs: number
): void {
  req.log?.info("WEB_FETCH_ATTEMPT", `${provider} ${result.success ? "success" : "failed"}`, {
    provider,
    format,
    success: result.success,
    status: result.status ?? (result.success ? 200 : 502),
    latencyMs,
    contentBytes: result.data ? new TextEncoder().encode(result.data.content).length : 0,
    fallbackReason: result.success ? null : (result.error ?? "provider_error"),
    fallback: req.fallback ?? false,
    urlHost: getUrlHost(req.url),
  });
}

function getUrlHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function isProviderCompatible(provider: WebFetchProviderId, req: WebFetchRequest): boolean {
  const format = req.format ?? "markdown";
  const depth = req.depth ?? 0;
  if (provider === "mdream") {
    return format === "markdown" && depth === 0 && !req.wait_for_selector;
  }
  if (provider === "parallel-extract") {
    return (format === "markdown" || format === "html") && depth === 0 && !req.wait_for_selector;
  }
  if (provider === "jina-reader" || provider === "tavily-search") {
    return format !== "screenshot" && depth === 0 && !req.wait_for_selector;
  }
  return true;
}

function resolveProviderCredentials(
  provider: WebFetchProviderId,
  credentials: WebFetchCredentials
): WebFetchCredentials | null {
  if (credentials.providerCredentials) {
    return credentials.providerCredentials[provider] ?? null;
  }
  return credentials;
}

function isRateLimitedCredentials(credentials: WebFetchCredentials): boolean {
  return credentials.allRateLimited === true;
}

function isRetryableQuotaStatus(provider: WebFetchProviderId, status: number | undefined): boolean {
  return (
    status === 429 ||
    (status !== undefined &&
      (getWebFetchProvider(provider)?.quotaStatusCodes?.includes(status) ?? false))
  );
}

function isRetryableQuotaResult(
  provider: WebFetchProviderId | null,
  result: WebFetchResult
): boolean {
  return isRetryableQuotaStatus(provider ?? "mdream", result.status);
}

function shouldTryNextProvider(provider: WebFetchProviderId, result: WebFetchResult): boolean {
  const status = result.status ?? 0;
  if ([401, 408, 500, 502, 503, 504].includes(status)) return true;
  if (isRetryableQuotaStatus(provider, status)) return true;
  return Boolean(result.error?.toLowerCase().includes("empty content"));
}

function rateLimitedResult(
  provider: WebFetchProviderId,
  credentials: WebFetchCredentials,
  lastResult?: WebFetchResult | null
): WebFetchResult {
  const retryAfter =
    credentials.retryAfter ??
    lastResult?.retryAfter ??
    new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const retryAfterHuman = credentials.retryAfterHuman ?? lastResult?.retryAfterHuman;
  return {
    success: false,
    status: 429,
    retryAfter,
    retryAfterHuman,
    error:
      credentials.lastError ||
      lastResult?.error ||
      `[${provider}] All accounts rate limited or quota-exhausted`,
  };
}

function withDefaultRetryAfter(result: WebFetchResult): WebFetchResult {
  if (result.retryAfter || result.retryAfterHuman) return result;
  return {
    ...result,
    retryAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

async function tryWebFetchProvider(
  provider: WebFetchProviderId,
  req: WebFetchRequest,
  credentials: WebFetchCredentials,
  format: WebFetchFormat,
  includeMetadata: boolean
): Promise<WebFetchResult> {
  try {
    switch (provider) {
      case "mdream":
        return await mdreamFetch({
          url: req.url,
          format,
          includeMetadata,
          headers: sanitizedMdreamRequestHeaders(req.headers),
        });

      case "parallel-extract":
        return await parallelExtractFetch({
          url: req.url,
          format,
          includeMetadata,
          credentials,
        });

      case "firecrawl":
        return await firecrawlFetch({
          url: req.url,
          format,
          depth: req.depth ?? 0,
          waitForSelector: req.wait_for_selector,
          includeMetadata,
          credentials,
        });

      case "jina-reader":
        return await jinaReaderFetch({
          url: req.url,
          format,
          includeMetadata,
          credentials,
        });

      case "tavily-search":
        return await tavilyFetch({
          url: req.url,
          format,
          includeMetadata,
          credentials,
        });

      case "tinyfish":
        return await tinyfishFetch({
          url: req.url,
          format,
          includeMetadata,
          credentials,
        });

      default: {
        const _exhaustive: never = provider;
        return {
          success: false,
          status: 400,
          error: `Unknown web fetch provider: ${_exhaustive}`,
        };
      }
    }
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? sanitizeErrorMessage(err.message) : sanitizeErrorMessage(String(err));
    const body = buildErrorBody(502, msg);
    return {
      success: false,
      status: 502,
      error: body.error.message,
    };
  }
}

function sanitizedMdreamRequestHeaders(headers: Headers | undefined): Headers | undefined {
  if (!headers) return undefined;

  const sanitized = new Headers(headers);
  // AICODE-NOTE: /v1/web/fetch authenticates with the same Bearer header as
  // other OmniRoute /v1 routes; Mdream privacy checks must not confuse that
  // gateway credential with page-specific Authorization/Cookie material.
  sanitized.delete("authorization");
  sanitized.delete("x-api-key");
  sanitized.delete("anthropic-version");
  return sanitized;
}
