// URL/format normalizers for provider key validation. Pure string helpers extracted from
// validation.ts (god-file decomposition): no I/O, no side effects — they only shape base URLs
// and chat endpoints per provider format. Behavior is byte-identical to the original inline defs.
import {
  stripAnthropicMessagesSuffix,
  stripClaudeCodeCompatibleEndpointSuffix,
} from "@omniroute/open-sse/services/claudeCodeCompatible.ts";
import { isOpenAICompatibleProvider } from "@/shared/constants/providers";

export const OPENAI_LIKE_FORMATS = new Set(["openai", "openai-responses"]);
export const GEMINI_LIKE_FORMATS = new Set(["gemini"]);

export function normalizeBaseUrl(baseUrl: string) {
  // Guard against a non-string baseUrl reaching .trim() / .replace() — see #2463
  // where NVIDIA NIM validation surfaced as `e.startsWith is not a function`
  // after the bundler renamed `baseUrl` to `e`. Any malformed providerSpecificData
  // (e.g. saved as object from a UI bug) would otherwise crash mid-validation.
  const value = typeof baseUrl === "string" ? baseUrl : "";
  return value.trim().replace(/\/$/, "");
}

export function buildCompatibleModelsUrl(baseUrl: string, modelsPath?: string) {
  const base = new URL(baseUrl);
  const path = modelsPath?.trim() || "models";
  const rawPath = path.replace(/^https?:\/\/[^/?#]*/i, "").split(/[?#]/, 1)[0];
  for (const segment of rawPath.split("/")) {
    let decoded = segment;
    for (let pass = 0; pass < 2; pass++) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        break;
      }
    }
    if (decoded === "." || decoded === "..") {
      throw new Error("Compatible models endpoint cannot contain dot-segment traversal");
    }
  }
  let target: URL;
  if (/^https?:\/\//i.test(path)) {
    target = new URL(path);
  } else {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const version = base.pathname.match(/(\/v\d+)$/i)?.[1];
    const joinedPath =
      version && normalizedPath.toLowerCase().startsWith(`${version.toLowerCase()}/`)
        ? `${base.pathname}${normalizedPath.slice(version.length)}`
        : `${base.pathname.replace(/\/$/, "")}${normalizedPath}`;
    target = new URL(joinedPath, base.origin);
  }
  if (target.username || target.password)
    throw new Error("Compatible models endpoint cannot include credentials");
  if (target.origin !== base.origin) {
    throw new Error("Compatible models endpoint must use the base URL origin");
  }
  return target.toString();
}

/**
 * Shape an OpenAI-compatible base URL into its `/v1/chat/completions` route. Accepts the API
 * root, a `/v1` root, a `/v1/models` URL, or a full `/v1/chat/completions` URL. Used by the
 * validators whose public `/v1/models` cannot prove a key (Zylo #13828, Inception).
 */
export function resolveV1ChatCompletionsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return "";
  const cleaned = normalized
    .replace(/\/chat\/completions$/, "")
    .replace(/\/models$/, "")
    .replace(/\/v1$/, "");
  return `${cleaned}/v1/chat/completions`;
}

export function normalizeAzureOpenAIBaseUrl(baseUrl: string) {
  return normalizeBaseUrl(baseUrl)
    .replace(/\/openai$/i, "")
    .replace(/\/openai\/deployments\/[^/]+\/chat\/completions.*$/i, "");
}

export function normalizeAnthropicBaseUrl(baseUrl: string) {
  return stripAnthropicMessagesSuffix(baseUrl || "");
}

export function normalizeClaudeCodeCompatibleBaseUrl(baseUrl: string) {
  return stripClaudeCodeCompatibleEndpointSuffix(baseUrl || "");
}

export function addModelsSuffix(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return "";

  // Endpoint URLs can carry request-only query flags (for example Kimi Code's
  // `/messages?beta=true`). A models probe targets a sibling path, so preserve
  // only the URL before the query/hash before replacing the endpoint suffix.
  const separatorIndex = normalized.search(/[?#]/);
  const endpoint = separatorIndex === -1 ? normalized : normalized.slice(0, separatorIndex);

  const suffixes = ["/chat/completions", "/responses", "/chat", "/messages"];
  if (endpoint.endsWith("/models")) {
    return endpoint;
  }
  for (const suffix of suffixes) {
    if (endpoint.endsWith(suffix)) {
      return `${endpoint.slice(0, -suffix.length)}/models`;
    }
  }

  return `${endpoint}/models`;
}

export function resolveBaseUrl(entry: any, providerSpecificData: any = {}) {
  if (providerSpecificData?.baseUrl) return normalizeBaseUrl(providerSpecificData.baseUrl);
  if (entry?.baseUrl) return normalizeBaseUrl(entry.baseUrl);
  return "";
}

export function resolveChatUrl(provider: string, baseUrl: string, providerSpecificData: any = {}) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return "";

  if (isOpenAICompatibleProvider(provider)) {
    if (providerSpecificData?.chatPath) {
      return `${normalized}${providerSpecificData.chatPath}`;
    }
    if (providerSpecificData?.apiType === "responses") {
      return `${normalized}/responses`;
    }
    return `${normalized}/chat/completions`;
  }

  if (
    normalized.endsWith("/chat/completions") ||
    normalized.endsWith("/responses") ||
    normalized.endsWith("/chat")
  ) {
    return normalized;
  }

  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }

  return normalized;
}

export function normalizeHerokuChatUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return "";
  return normalized.endsWith("/v1/chat/completions")
    ? normalized
    : `${normalized}/v1/chat/completions`;
}

export function normalizeDatabricksChatUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return "";
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

export function normalizeSnowflakeChatUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl)
    .replace(/\/cortex\/inference:complete$/, "")
    .replace(/\/api\/v2$/, "");
  if (!normalized) return "";
  return `${normalized}/api/v2/cortex/inference:complete`;
}

export function normalizeGigachatChatUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl).replace(/\/chat\/completions$/, "");
  if (!normalized) return "";
  return `${normalized}/chat/completions`;
}
