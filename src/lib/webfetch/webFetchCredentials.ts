/**
 * Fork-specific web-fetch credential resolution for `/v1/web/fetch`.
 *
 * Extracted from `src/app/api/v1/web/fetch/route.ts` so the upstream-shaped
 * route stays a thin shell. The per-provider credential mapping (Parallel reuses
 * the `parallel` connection / `PARALLEL_API_KEY`, Mdream is keyless) and the
 * fallback credential map live here, in one fork-owned module, keeping the
 * upstream route diff small for future OmniRoute pulls.
 */
import {
  WEB_FETCH_PROVIDER_ORDER,
  getWebFetchProvider,
  type WebFetchProviderId,
} from "@omniroute/open-sse/config/webFetchRegistry.ts";
import type { WebFetchCredentials } from "@omniroute/open-sse/handlers/webFetch.ts";
import { getProviderCredentials } from "@/sse/services/auth";

export interface WebFetchExecutionPlan {
  resolvedProvider?: WebFetchProviderId;
  credentials: WebFetchCredentials;
  errorStatus?: number;
  errorMessage?: string;
}

/**
 * Resolve credentials for a single web-fetch provider. Mdream is keyless;
 * Parallel Extract reuses the `parallel` connection or `PARALLEL_API_KEY`.
 */
async function resolveCredentials(
  providerId: WebFetchProviderId
): Promise<{ apiKey?: string } | null> {
  if (providerId === "mdream") return {};

  try {
    const credentialProviderId = providerId === "parallel-extract" ? "parallel" : providerId;
    const creds = await getProviderCredentials(credentialProviderId);
    if (creds) return creds;
    if (providerId === "parallel-extract" && process.env.PARALLEL_API_KEY) {
      return { apiKey: process.env.PARALLEL_API_KEY };
    }
    return null;
  } catch {
    if (providerId === "parallel-extract" && process.env.PARALLEL_API_KEY) {
      return { apiKey: process.env.PARALLEL_API_KEY };
    }
    return null;
  }
}

async function resolveProviderCredentialMap(): Promise<
  Partial<Record<WebFetchProviderId, { apiKey?: string }>>
> {
  const entries = await Promise.all(
    WEB_FETCH_PROVIDER_ORDER.map(
      async (providerId) => [providerId, await resolveCredentials(providerId)] as const
    )
  );
  return Object.fromEntries(entries.filter(([, credentials]) => credentials)) as Partial<
    Record<WebFetchProviderId, { apiKey?: string }>
  >;
}

/**
 * Resolve the provider + credentials plan for a web-fetch request: an explicit
 * provider (with its credentials) or the auto chain (full credential map). On a
 * missing required credential for an explicit provider, returns a flat error
 * descriptor (the route compiles with `strict: false`, so no union narrowing).
 */
export async function resolveWebFetchExecution(body: {
  provider?: string;
  fallback?: boolean;
}): Promise<WebFetchExecutionPlan> {
  if (body.provider) {
    const resolvedProvider = body.provider as WebFetchProviderId;
    const provider = getWebFetchProvider(resolvedProvider);
    const creds = await resolveCredentials(resolvedProvider);
    if (!creds && provider?.authType !== "none") {
      return {
        credentials: {},
        errorStatus: 400,
        errorMessage:
          `No credentials configured for web-fetch provider: ${resolvedProvider}. ` +
          `Add an API key for "${resolvedProvider}" in the dashboard.`,
      };
    }
    return {
      resolvedProvider,
      credentials: {
        ...(creds ?? {}),
        providerCredentials: body.fallback ? await resolveProviderCredentialMap() : undefined,
      },
    };
  }

  return { credentials: { providerCredentials: await resolveProviderCredentialMap() } };
}
