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
import * as log from "@/sse/utils/logger";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth";
import { enforceApiKeyPolicy } from "@/shared/utils/apiKeyPolicy";
import { isRequireApiKeyEnabled } from "@/shared/utils/featureFlags";
import { v1WebFetchSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { resolveWebFetchExecution } from "@/lib/webfetch/webFetchCredentials";

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
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

  // Resolve provider + credentials (fork-specific, in webFetchCredentials).
  const plan = await resolveWebFetchExecution(body);
  if (plan.errorMessage) {
    return errorResponse(plan.errorStatus ?? HTTP_STATUS.BAD_REQUEST, plan.errorMessage);
  }

  log.info(
    "WEB_FETCH",
    `${plan.resolvedProvider ?? "auto"} | ${getUrlHost(body.url)} | format=${body.format}`
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
    plan.credentials,
    plan.resolvedProvider
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
