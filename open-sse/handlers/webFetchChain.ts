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
import { WEB_FETCH_PROVIDER_ORDER, type WebFetchProviderId } from "../config/webFetchRegistry.ts";
import { tavilyFetch } from "../executors/tavily-fetch.ts";
import { firecrawlFetch } from "../executors/firecrawl-fetch.ts";
import { jinaReaderFetch } from "../executors/jina-reader-fetch.ts";
import { mdreamFetch } from "../executors/mdream-fetch.ts";
import { parallelExtractFetch } from "../executors/parallel-extract.ts";
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
  const providerChain = buildProviderChain(resolvedProvider ?? req.provider, req.fallback ?? false);
  const compatibleProviders = providerChain.filter((provider) =>
    isProviderCompatible(provider, req)
  );
  const providers = compatibleProviders.length > 0 ? compatibleProviders : providerChain;

  let lastResult: WebFetchResult | null = null;
  for (const provider of providers) {
    const providerCredentials = resolveProviderCredentials(provider, credentials);
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
    if (!shouldTryNextProvider(result) || ((resolvedProvider || req.provider) && !req.fallback)) {
      return result;
    }
  }

  return (
    lastResult ?? {
      success: false,
      status: 400,
      error: "No compatible web fetch provider available",
    }
  );
}

function buildProviderChain(
  explicitProvider: WebFetchProviderId | undefined,
  fallback: boolean
): WebFetchProviderId[] {
  if (!explicitProvider) return [...WEB_FETCH_PROVIDER_ORDER];
  if (!fallback) return [explicitProvider];

  const startIndex = WEB_FETCH_PROVIDER_ORDER.indexOf(explicitProvider);
  const afterExplicit =
    startIndex >= 0
      ? WEB_FETCH_PROVIDER_ORDER.slice(startIndex + 1)
      : WEB_FETCH_PROVIDER_ORDER.filter((provider) => provider !== explicitProvider);
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
): WebFetchCredentials {
  return credentials.providerCredentials?.[provider] ?? credentials;
}

function shouldTryNextProvider(result: WebFetchResult): boolean {
  const status = result.status ?? 0;
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
  if (status === 401 || status === 403) return true;
  return Boolean(result.error?.toLowerCase().includes("empty content"));
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
          headers: req.headers,
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
