import { resolveProxyForConnection } from "@/lib/db/settings";
import { logProxyEvent } from "@/lib/proxyLogger";
import { runWithDirectProxyContext, runWithProxyContext } from "../../utils/proxyFetch.ts";

type SearchProxyConfig = {
  type: string;
  host: string;
  port: number | string;
  family?: string;
};

export type SearchProxyAttempt = {
  providerId: string;
  connectionId?: string | null;
  apiKeyId?: string | null;
  url: string;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
};

export type SearchProxyResult = {
  response: Response;
  connectionId: string | null;
  proxy: SearchProxyConfig | null;
  level: string;
  levelId: string | null;
  durationMs: number;
};

export type SearchProxyOperation<T> = {
  providerId: string;
  connectionId?: string | null;
  apiKeyId?: string | null;
  url: string;
  operation: () => Promise<T> | T;
  status?: (value: T) => string;
};

type SearchProxyBinding = {
  proxy?: unknown;
  level?: string;
  levelId?: string | null;
};

function safeTargetUrl(rawUrl: string): string {
  try {
    const target = new URL(rawUrl);
    return `${target.origin}${target.pathname}`;
  } catch {
    return "/";
  }
}

function sanitizeProxy(proxy: unknown): SearchProxyConfig | null {
  if (!proxy || typeof proxy !== "object") return null;
  const value = proxy as Record<string, unknown>;
  if (
    typeof value.type !== "string" ||
    typeof value.host !== "string" ||
    (typeof value.port !== "number" && typeof value.port !== "string")
  ) {
    return null;
  }
  return {
    type: value.type,
    host: value.host,
    port: value.port,
    ...(typeof value.family === "string" ? { family: value.family } : {}),
  };
}

function proxyStatus(error: unknown): string {
  if (!error) return "success";
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || name === "TimeoutError" ? "timeout" : "error";
}

async function resolveSearchProxyBinding(
  connectionId: string | null,
  apiKeyId: string | null | undefined,
  providerId: string
): Promise<SearchProxyBinding> {
  const direct: SearchProxyBinding = { proxy: null, level: "direct", levelId: null };
  if (!connectionId) return direct;

  try {
    return (
      (await resolveProxyForConnection(connectionId, apiKeyId || undefined, providerId)) || direct
    );
  } catch {
    // A resolver outage must not turn a provider request into a gateway error.
    return direct;
  }
}

async function executeWithSearchProxy<T>(attempt: SearchProxyOperation<T>): Promise<{
  value: T;
  binding: SearchProxyBinding;
  connectionId: string | null;
  durationMs: number;
}> {
  // AICODE-NOTE: binding is resolved per attempt, never inherited from a prior
  // provider, preventing fallback traffic from leaking through primary proxy.
  const connectionId = attempt.connectionId || null;
  const binding = await resolveSearchProxyBinding(
    connectionId,
    attempt.apiKeyId,
    attempt.providerId
  );
  const startedAt = Date.now();
  let failure: unknown = null;
  let operationStatus: string | undefined;
  try {
    const operation = () => attempt.operation();
    const value = binding.proxy
      ? await runWithProxyContext(binding.proxy, operation)
      : await runWithDirectProxyContext(operation);
    operationStatus = attempt.status?.(value);
    return { value, binding, connectionId, durationMs: Date.now() - startedAt };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      logProxyEvent({
        status: operationStatus || proxyStatus(failure),
        proxy: sanitizeProxy(binding.proxy),
        level: binding.level || "direct",
        levelId: binding.levelId || null,
        provider: attempt.providerId,
        targetUrl: safeTargetUrl(attempt.url),
        latencyMs: Date.now() - startedAt,
        connectionId,
        account: connectionId ? connectionId.slice(0, 8) : null,
      });
    } catch {
      // Proxy observability must never change search response behavior.
    }
  }
}

export async function executeSearchOperation<T>(attempt: SearchProxyOperation<T>): Promise<T> {
  const execution = await executeWithSearchProxy(attempt);
  return execution.value;
}

/**
 * Search transport chokepoint. Every attempt resolves its own connection/API-key
 * proxy binding, then runs fetch inside that context. Resolution and observability
 * are best-effort: a broken resolver or logger falls back to direct transport.
 */
export async function executeSearchRequest(
  attempt: SearchProxyAttempt
): Promise<SearchProxyResult> {
  const fetchImpl = attempt.fetchImpl || globalThis.fetch;
  const execution = await executeWithSearchProxy({
    providerId: attempt.providerId,
    connectionId: attempt.connectionId,
    apiKeyId: attempt.apiKeyId,
    url: attempt.url,
    operation: () => fetchImpl(attempt.url, attempt.init),
    status: (response) => (response.ok ? "success" : "error"),
  });

  return {
    response: execution.value,
    connectionId: execution.connectionId,
    proxy: sanitizeProxy(execution.binding.proxy),
    level: execution.binding.level || "direct",
    levelId: execution.binding.levelId || null,
    durationMs: execution.durationMs,
  };
}
