import { NextResponse } from "next/server";
import {
  SEARCH_PROVIDERS,
  SEARCH_CREDENTIAL_FALLBACKS,
  SEARCH_AUTO_PROVIDER_ORDER,
} from "@omniroute/open-sse/config/searchRegistry.ts";
import {
  WEB_FETCH_PROVIDERS,
  WEB_FETCH_PROVIDER_ORDER,
} from "@omniroute/open-sse/config/webFetchRegistry.ts";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import { getProviderCredentials } from "@/sse/services/auth";
import { isAllRateLimitedCredentials } from "@/app/api/v1/_shared/rateLimit";
import { buildErrorBody } from "@omniroute/open-sse/utils/error.ts";
import {
  SearchProviderCatalogResponseSchema,
  RoutingOverrideRequestSchema,
  type SearchProviderCatalogItem,
} from "@/shared/schemas/searchTools";
import {
  buildEffectiveRoutingConfig,
  resetRoutingOverride,
  saveRoutingOverride,
  type RoutingEndpoint,
} from "@/lib/routing/routingOverrides";
import * as log from "@/sse/utils/logger";

// ---------------------------------------------------------------------------
// Fetch provider metadata
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Credential status resolution
// ---------------------------------------------------------------------------

type ProviderStatus = "configured" | "missing" | "rate_limited";

/**
 * Determine credential status for a provider (search or fetch).
 * - "configured"  : at least one active key is available
 * - "rate_limited": all keys exist but are currently rate-limited
 * - "missing"     : no credentials found
 *
 * Respects SEARCH_CREDENTIAL_FALLBACKS (e.g. perplexity-search → perplexity).
 */
async function resolveProviderStatus(
  providerId: string,
  useCredentialFallback = true
): Promise<ProviderStatus> {
  if (providerId === "mdream") return "configured";
  if (providerId === "parallel-search" && process.env.PARALLEL_API_KEY) return "configured";

  try {
    const credentialProviderId = providerId === "parallel-extract" ? "parallel" : providerId;
    const credentials = await getProviderCredentials(credentialProviderId).catch(() => null);

    // Active credentials available
    if (credentials && !isAllRateLimitedCredentials(credentials)) {
      return "configured";
    }

    // All rate limited — check fallback before returning rate_limited
    if (isAllRateLimitedCredentials(credentials)) {
      if (useCredentialFallback) {
        const fallbackId = SEARCH_CREDENTIAL_FALLBACKS[providerId];
        if (fallbackId) {
          const fallbackCreds = await getProviderCredentials(fallbackId).catch(() => null);
          if (fallbackCreds && !isAllRateLimitedCredentials(fallbackCreds)) {
            return "configured";
          }
        }
      }
      return "rate_limited";
    }

    // null → no credentials; try fallback
    if (useCredentialFallback) {
      const fallbackId = SEARCH_CREDENTIAL_FALLBACKS[providerId];
      if (fallbackId) {
        const fallbackCreds = await getProviderCredentials(fallbackId).catch(() => null);
        if (fallbackCreds && !isAllRateLimitedCredentials(fallbackCreds)) {
          return "configured";
        }
        if (isAllRateLimitedCredentials(fallbackCreds)) {
          return "rate_limited";
        }
      }
    }

    return "missing";
  } catch {
    return "missing";
  }
}

function getEndpointProviderIds(endpoint: RoutingEndpoint): string[] {
  return endpoint === "search" ? [...SEARCH_AUTO_PROVIDER_ORDER] : [...WEB_FETCH_PROVIDER_ORDER];
}

function getEndpointProviders(endpoint: RoutingEndpoint): Record<string, { id: string }> {
  return endpoint === "search" ? SEARCH_PROVIDERS : WEB_FETCH_PROVIDERS;
}

async function buildRoutingCatalog() {
  return {
    search: await buildEffectiveRoutingConfig("search", SEARCH_AUTO_PROVIDER_ORDER),
    fetch: await buildEffectiveRoutingConfig("fetch", WEB_FETCH_PROVIDER_ORDER),
  };
}

async function validateRoutingOverride(
  endpoint: RoutingEndpoint,
  order: string[],
  disabled: string[]
): Promise<string | null> {
  const registry = getEndpointProviders(endpoint);
  const validIds = new Set(getEndpointProviderIds(endpoint));
  const referenced = [...new Set([...order, ...disabled])];
  const unknownId = referenced.find((id) => !registry[id]);
  if (unknownId) return `Unknown ${endpoint} provider: ${unknownId}`;

  const wrongKindId = referenced.find((id) => !validIds.has(id));
  if (wrongKindId) return `Provider ${wrongKindId} is not routable for ${endpoint}`;

  const disabledSet = new Set(disabled);
  const enabledIds = getEndpointProviderIds(endpoint).filter((id) => !disabledSet.has(id));
  if (enabledIds.length === 0) return `At least one ${endpoint} provider must remain enabled`;

  const statuses = await Promise.all(enabledIds.map((id) => resolveProviderStatus(id)));
  const missingIndex = statuses.findIndex((status) => status === "missing");
  if (missingIndex >= 0) {
    return `Provider ${enabledIds[missingIndex]} is missing credentials and cannot be enabled for automatic routing`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(buildErrorBody(401, "Unauthorized"), { status: 401 });
  }

  try {
    const routing = await buildRoutingCatalog();
    const searchOrder = new Map(routing.search.order.map((id, index) => [id, index + 1]));
    const fetchOrder = new Map(routing.fetch.order.map((id, index) => [id, index + 1]));
    const searchDisabled = new Set(routing.search.disabled);
    const fetchDisabled = new Set(routing.fetch.disabled);

    // -----------------------------------------------------------------------
    // 1. Build search providers (12 from registry)
    // -----------------------------------------------------------------------
    const searchProviderStatuses = await Promise.all(
      Object.values(SEARCH_PROVIDERS).map((p) =>
        resolveProviderStatus(p.id).then((status) => ({ p, status }))
      )
    );

    const searchItems: SearchProviderCatalogItem[] = searchProviderStatuses.map(
      ({ p, status }) => ({
        id: p.id,
        name: p.name,
        kind: "search" as const,
        costPerQuery: p.costPerQuery,
        freeMonthlyQuota: p.freeMonthlyQuota,
        searchTypes: p.searchTypes,
        status,
        order: searchOrder.get(p.id) ?? null,
        routingStatus: status,
        enabledForAuto: !searchDisabled.has(p.id) && searchOrder.has(p.id),
        configureHref: "/dashboard/providers",
      })
    );

    // -----------------------------------------------------------------------
    // 2. Build fetch providers
    // -----------------------------------------------------------------------
    const fetchProviders = Object.values(WEB_FETCH_PROVIDERS);
    const fetchProviderStatuses = await Promise.all(
      fetchProviders.map((fp) =>
        resolveProviderStatus(fp.id, false).then((status) => ({ fp, status }))
      )
    );

    const fetchItems: SearchProviderCatalogItem[] = fetchProviderStatuses.map(({ fp, status }) => ({
      id: fp.id,
      name: fp.name,
      kind: "fetch" as const,
      costPerQuery: fp.costPerQuery,
      freeMonthlyQuota: fp.freeMonthlyQuota,
      fetchFormats: fp.fetchFormats,
      status,
      order: fetchOrder.get(fp.id) ?? null,
      routingStatus: status,
      enabledForAuto: !fetchDisabled.has(fp.id) && fetchOrder.has(fp.id),
      configureHref: "/dashboard/providers",
    }));

    // -----------------------------------------------------------------------
    // 3. Combine: search first, then fetch
    // -----------------------------------------------------------------------
    const providers: SearchProviderCatalogItem[] = [...searchItems, ...fetchItems];

    // -----------------------------------------------------------------------
    // 4. Defensive schema validation — log warning but still return on failure
    // -----------------------------------------------------------------------
    const parseResult = SearchProviderCatalogResponseSchema.safeParse({ providers, routing });
    if (!parseResult.success) {
      log.warn(
        "SEARCH_PROVIDERS",
        `Response schema validation warning: ${parseResult.error.message}`
      );
    }

    return NextResponse.json({ providers, routing });
  } catch (error) {
    log.error("SEARCH_PROVIDERS", "Failed to list providers", error);
    return NextResponse.json(buildErrorBody(500, "Failed to list providers"), { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(buildErrorBody(401, "Unauthorized"), { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(buildErrorBody(400, "Invalid JSON body"), { status: 400 });
  }

  const parsed = RoutingOverrideRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(buildErrorBody(400, parsed.error.message), { status: 400 });
  }

  const { endpoint, reset } = parsed.data;
  if (reset) {
    await resetRoutingOverride(endpoint);
    const routing = await buildRoutingCatalog();
    return NextResponse.json({ routing: routing[endpoint] });
  }

  const validationError = await validateRoutingOverride(
    endpoint,
    parsed.data.order,
    parsed.data.disabled
  );
  if (validationError) {
    return NextResponse.json(buildErrorBody(400, validationError), { status: 400 });
  }

  await saveRoutingOverride({
    endpoint,
    order: parsed.data.order,
    disabled: parsed.data.disabled,
  });

  const routing = await buildRoutingCatalog();
  return NextResponse.json({ routing: routing[endpoint] });
}
