import { randomUUID } from "node:crypto";

import {
  attachOmniRouteMetaHeaders,
  getOmniRouteTokenCounts,
} from "@/domain/omnirouteResponseMeta";
import { createErrorResponse } from "@/lib/api/errorResponse";
import { saveCallLog } from "@/lib/usage/callLogs";
import { CORS_HEADERS, handleCorsOptions } from "@/shared/utils/cors";
import { enforceApiKeyPolicy } from "@/shared/utils/apiKeyPolicy";
import {
  dispatchSystemOneRequest,
  type SystemOneAttempt,
  type SystemOneDispatchResult,
} from "@omniroute/open-sse/services/systemOne/dispatch.ts";
import {
  loadSystemOneConfig,
  type SystemOneConfig,
} from "@omniroute/open-sse/services/systemOne/config.ts";
import {
  parseSystemOneModelSelection,
  parseSystemOneRequest,
  readSystemOneJsonBody,
  SYSTEMONE_ACCEPTED_MODEL_FORMS,
  type SystemOneRequest,
} from "@omniroute/open-sse/services/systemOne/schema.ts";

type SystemOnePolicyResult = {
  apiKeyInfo?: { id?: string; name?: string } | null;
  rejection: Response | null;
};

export interface SystemOnePostHandlerDependencies {
  getConfig?: () => SystemOneConfig;
  enforceApiKeyPolicy?: (request: Request, model: string) => Promise<SystemOnePolicyResult>;
  dispatch?: (body: SystemOneRequest, config: SystemOneConfig) => Promise<SystemOneDispatchResult>;
  saveCallLog?: (entry: Record<string, unknown>) => Promise<unknown>;
}

function notFoundResponse(request: Request): Response {
  const pathname = new URL(request.url).pathname;
  return Response.json(
    {
      error: {
        message: `Unknown API route: ${pathname}`,
        type: "not_found",
        code: "unknown_route",
        path: pathname,
      },
    },
    {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    }
  );
}

function withCorsHeaders(headers: Headers): Headers {
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  headers.set("Content-Type", "application/json");
  return headers;
}

function attemptHeader(attempts: SystemOneAttempt[]): string | null {
  if (attempts.length === 0) return null;
  return attempts.map(({ upstream, status }) => `${upstream}:${status}`).join(",");
}

function logAttempts(
  attempts: SystemOneAttempt[],
  apiKeyInfo: SystemOnePolicyResult["apiKeyInfo"],
  save: NonNullable<SystemOnePostHandlerDependencies["saveCallLog"]>
): void {
  for (const attempt of attempts) {
    const usage = attempt.usage;
    const tokenCounts = getOmniRouteTokenCounts(usage);
    const entry: Record<string, unknown> = {
      method: "POST",
      path: "/v1/systemone",
      status: attempt.status,
      model: attempt.model,
      provider: attempt.upstream,
      connectionId: attempt.connectionId,
      duration: attempt.durationMs,
      tokens: {
        input_tokens: tokenCounts.input,
        output_tokens: tokenCounts.output,
      },
      apiKeyId: apiKeyInfo?.id || undefined,
      apiKeyName: apiKeyInfo?.name || undefined,
    };
    if (usage && Object.hasOwn(usage, "cost")) entry.costUsd = usage.cost;
    // AICODE-NOTE: Upstream error text may echo state; logs retain safe type and status only.
    if (attempt.errorMessage) entry.error = "systemone_upstream_error";

    void save(entry).catch(() => undefined);
  }
}

async function wrapErrorResponse(
  response: Response,
  attempts: SystemOneAttempt[],
  meta: Parameters<typeof attachOmniRouteMetaHeaders>[1]
): Promise<Response> {
  const headers = withCorsHeaders(new Headers(response.headers));
  const formattedAttempts = attemptHeader(attempts);
  if (formattedAttempts) headers.set("X-OmniRoute-SystemOne-Attempts", formattedAttempts);

  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { requestId?: unknown } | null;
  attachOmniRouteMetaHeaders(headers, {
    ...meta,
    requestId: typeof body?.requestId === "string" ? body.requestId : meta.requestId,
  });
  return new Response(response.body, { status: response.status, headers });
}

export function createSystemOnePostHandler(
  dependencies: SystemOnePostHandlerDependencies = {}
): (request: Request) => Promise<Response> {
  const getConfig = dependencies.getConfig ?? loadSystemOneConfig;
  const checkApiKey = dependencies.enforceApiKeyPolicy ?? enforceApiKeyPolicy;
  const dispatch = dependencies.dispatch ?? dispatchSystemOneRequest;
  const save = dependencies.saveCallLog ?? saveCallLog;

  return async (request: Request): Promise<Response> => {
    const config = getConfig();
    // Keep disabled deployments indistinguishable from an unknown upstream route.
    if (!config.enabled) return notFoundResponse(request);

    const readResult = await readSystemOneJsonBody(request);
    if (readResult.ok === false) {
      const response = createErrorResponse({
        status: readResult.status,
        message: readResult.message,
      });
      return wrapErrorResponse(response, [], { latencyMs: 0 });
    }

    const parsed = parseSystemOneRequest(readResult.value);
    if (parsed.success === false) {
      const response = createErrorResponse({ status: 400, message: parsed.message });
      return wrapErrorResponse(response, [], { latencyMs: 0 });
    }

    const body = parsed.data;
    if (parseSystemOneModelSelection(body.model).kind === "invalid") {
      // AICODE-NOTE: Reject unknown model syntax before applying key policy or dispatching.
      const response = createErrorResponse({
        status: 400,
        message: `Invalid SystemOne model. Accepted forms: ${SYSTEMONE_ACCEPTED_MODEL_FORMS}`,
      });
      return wrapErrorResponse(response, [], { latencyMs: 0 });
    }

    const policyModel = `systemone/${body.model ?? "auto"}`;
    const policy = await checkApiKey(request, policyModel);
    if (policy.rejection) return policy.rejection;

    const result = await dispatch(body, config);
    logAttempts(result.attempts, policy.apiKeyInfo, save);

    if (result.ok === false) {
      const response = createErrorResponse({
        status: result.status,
        message: result.errorMessage,
        ...(result.upstreamStatus === null ? {} : { details: { status: result.upstreamStatus } }),
      });
      return wrapErrorResponse(response, result.attempts, {
        provider: result.attempts.at(-1)?.upstream ?? null,
        model: result.attempts.at(-1)?.model ?? null,
        latencyMs: result.latencyMs,
      });
    }

    const headers = withCorsHeaders(new Headers());
    const formattedAttempts = attemptHeader(result.attempts);
    if (formattedAttempts) headers.set("X-OmniRoute-SystemOne-Attempts", formattedAttempts);
    const requestId = randomUUID();
    attachOmniRouteMetaHeaders(headers, {
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      requestId,
    });
    return Response.json(result.body, { status: result.status, headers });
  };
}

export const POST = createSystemOnePostHandler();

export async function OPTIONS(): Promise<Response> {
  return handleCorsOptions();
}
