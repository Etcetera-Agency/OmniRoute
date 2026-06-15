/**
 * POST /v1/web/fetch
 *
 * Extract content from a URL using a configured web-fetch provider.
 *
 * Request: { url, provider?, format?, depth?, wait_for_selector?, include_metadata?, fallback? }
 * Response: { provider, url, content, links, metadata, screenshot_url }
 */

import { errorResponse } from "@omniroute/open-sse/utils/error.ts";
import { HTTP_STATUS } from "@omniroute/open-sse/config/constants.ts";
import { handleWebFetch } from "@omniroute/open-sse/handlers/webFetch.ts";
import {
  WEB_FETCH_PROVIDER_ORDER,
  getWebFetchProvider,
  type WebFetchProviderId,
} from "@omniroute/open-sse/config/webFetchRegistry.ts";
import * as log from "@/sse/utils/logger";
import { extractApiKey, isValidApiKey, getProviderCredentials } from "@/sse/services/auth";
import { enforceApiKeyPolicy } from "@/shared/utils/apiKeyPolicy";
import { isRequireApiKeyEnabled } from "@/shared/utils/featureFlags";
import { v1WebFetchSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * Resolve credentials for a web-fetch provider. Tries each known provider in
 * priority order when no explicit provider is requested.
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

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    log.warn("WEB_FETCH", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const validation = validateBody(v1WebFetchSchema, rawBody);
  if (isValidationFailure(validation)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, validation.error.message);
  }
  const body = validation.data;

  // Optional auth check
  const apiKeyRaw = extractApiKey(request);
  if (isRequireApiKeyEnabled() && !apiKeyRaw) {
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Authentication required");
  }
  if (apiKeyRaw && !(await isValidApiKey(apiKeyRaw))) {
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  // Enforce API key policies
  const policy = await enforceApiKeyPolicy(request, "web-fetch");
  if (policy.rejection) return policy.rejection;

  // Resolve provider + credentials
  let resolvedProvider: WebFetchProviderId | undefined;
  let credentials: {
    apiKey?: string;
    providerCredentials?: Partial<Record<WebFetchProviderId, { apiKey?: string }>>;
  } = {};

  if (body.provider) {
    resolvedProvider = body.provider as WebFetchProviderId;
    const provider = getWebFetchProvider(resolvedProvider);
    const creds = await resolveCredentials(resolvedProvider);
    if (!creds && provider?.authType !== "none") {
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        `No credentials configured for web-fetch provider: ${resolvedProvider}. ` +
          `Add an API key for "${resolvedProvider}" in the dashboard.`
      );
    }
    credentials = {
      ...(creds ?? {}),
      providerCredentials: body.fallback ? await resolveProviderCredentialMap() : undefined,
    };
  } else {
    credentials = { providerCredentials: await resolveProviderCredentialMap() };
  }

  log.info(
    "WEB_FETCH",
    `${resolvedProvider ?? "auto"} | ${getUrlHost(body.url)} | format=${body.format}`
  );

  const result = await handleWebFetch(
    {
      url: body.url,
      format: body.format,
      depth: body.depth as 0 | 1 | 2,
      wait_for_selector: body.wait_for_selector,
      include_metadata: body.include_metadata,
      fallback: body.fallback,
      headers: request.headers,
      log,
    },
    credentials,
    resolvedProvider
  );

  if (!result.success) {
    return new Response(
      JSON.stringify({
        error: { message: result.error ?? "Web fetch failed", type: "web_fetch_error" },
      }),
      {
        status: result.status ?? 502,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  return new Response(JSON.stringify(result.data), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function getUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}
