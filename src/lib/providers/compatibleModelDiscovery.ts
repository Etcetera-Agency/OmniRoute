import { isForbiddenCustomHeaderName } from "@/shared/constants/upstreamHeaders";
import {
  buildCompatibleModelsUrl,
  normalizeAnthropicBaseUrl,
} from "@/shared/utils/compatibleProviderUrls";

// AICODE-NOTE: Explicit endpoints never fall back, and Anthropic pages must finish before persistence.
export function applyCompatibleCapabilityOverrides(
  models: unknown[],
  modelsById: Record<string, { supportsVision?: boolean; supportsTools?: boolean }>
) {
  return models.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const model = value as Record<string, unknown>;
    if (typeof model.id !== "string") return value;
    const source = modelsById[model.id];
    if (!source) return value;
    return {
      ...model,
      ...(source.supportsVision !== undefined ? { supportsVision: source.supportsVision } : {}),
      ...(source.supportsTools !== undefined ? { supportsTools: source.supportsTools } : {}),
    };
  });
}

export function compatibleCapabilityMap(
  models: unknown[]
): Record<string, { supportsVision?: boolean; supportsTools?: boolean }> {
  const entries: Array<[string, { supportsVision?: boolean; supportsTools?: boolean }]> = [];
  for (const value of models) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const model = value as Record<string, unknown>;
    if (typeof model.id !== "string") continue;
    const capabilities: { supportsVision?: boolean; supportsTools?: boolean } = {};
    if (typeof model.supportsVision === "boolean") {
      capabilities.supportsVision = model.supportsVision;
    }
    if (typeof model.supportsTools === "boolean") capabilities.supportsTools = model.supportsTools;
    entries.push([model.id, capabilities]);
  }
  return Object.fromEntries(entries);
}

type CompatibleCatalogInput = {
  type: "openai-compatible" | "anthropic-compatible";
  baseUrl: string;
  modelsPath?: string;
  apiKey: string;
  accessToken: string;
  providerSpecificData: unknown;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
};

const MAX_ANTHROPIC_PAGES = 20;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function headersFor(
  type: CompatibleCatalogInput["type"],
  apiKey: string,
  accessToken: string,
  data: unknown
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (type === "anthropic-compatible") {
    if (apiKey) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    const token = accessToken || apiKey;
    if (token) headers.Authorization = `Bearer ${token}`;
  } else {
    const token = apiKey || accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const custom = record(data);
  if (typeof custom.customUserAgent === "string" && custom.customUserAgent.trim()) {
    headers["User-Agent"] = custom.customUserAgent.trim();
  }
  const customHeaders = record(custom.customHeaders);
  for (const [name, value] of Object.entries(customHeaders)) {
    const trimmed = name.trim();
    if (!trimmed || typeof value !== "string" || isForbiddenCustomHeaderName(trimmed)) continue;
    if (/[\r\n\0]/.test(trimmed) || /[\r\n\0]/.test(value)) continue;
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === trimmed.toLowerCase()) delete headers[existing];
    }
    headers[trimmed] = value;
  }
  return headers;
}

async function readPage(
  input: CompatibleCatalogInput,
  url: string,
  headers: Record<string, string>
) {
  const response = await input.fetchImpl(url, { method: "GET", headers });
  if (!response.ok) throw new Error(`Compatible model catalog request failed (${response.status})`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Compatible model catalog response was invalid");
  }
  return body as Record<string, unknown>;
}

function persistedSourceUrl(requestUrl: string): string {
  const sourceUrl = new URL(requestUrl);
  sourceUrl.search = "";
  sourceUrl.hash = "";
  return sourceUrl.toString();
}

export async function fetchCompatibleModelCatalog(input: CompatibleCatalogInput) {
  const data = record(input.providerSpecificData);
  const configuredPath =
    input.modelsPath || (typeof data.modelsPath === "string" ? data.modelsPath : undefined);
  let baseUrl = input.baseUrl;
  if (input.type === "anthropic-compatible") baseUrl = normalizeAnthropicBaseUrl(baseUrl);
  let defaultUrls: string[];
  if (input.type === "openai-compatible" && !configuredPath) {
    let base = input.baseUrl.replace(/\/$/, "");
    if (base.endsWith("/chat/completions")) base = base.slice(0, -17);
    else if (base.endsWith("/completions")) base = base.slice(0, -12);
    if (base.endsWith("/v1") && !base.endsWith("://v1")) base = base.slice(0, -3);
    defaultUrls = [
      ...new Set([
        buildCompatibleModelsUrl(base, "/v1/models"),
        buildCompatibleModelsUrl(base, "/models"),
        buildCompatibleModelsUrl(input.baseUrl, "/models"),
      ]),
    ];
  } else {
    defaultUrls = [buildCompatibleModelsUrl(baseUrl, configuredPath)];
  }
  const headers = headersFor(
    input.type,
    input.apiKey,
    input.accessToken,
    input.providerSpecificData
  );

  if (input.type === "openai-compatible") {
    let lastError: unknown;
    for (const sourceUrl of defaultUrls) {
      try {
        const body = await readPage(input, sourceUrl, headers);
        const models = body.data ?? body.models;
        if (!Array.isArray(models)) {
          throw new Error("Compatible model catalog response had no model list");
        }
        return { sourceUrl: persistedSourceUrl(sourceUrl), models };
      } catch (error) {
        if (configuredPath) throw error;
        lastError = error;
        if (error instanceof Error && /\(401\)|\(403\)/.test(error.message)) throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Compatible model catalog unavailable");
  }

  const sourceUrl = defaultUrls[0];
  const models: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_ANTHROPIC_PAGES; page++) {
    const pageUrl = new URL(sourceUrl);
    if (cursor) pageUrl.searchParams.set("after_id", cursor);
    const body = await readPage(input, pageUrl.toString(), headers);
    if (!Array.isArray(body.data))
      throw new Error("Anthropic model catalog response had no data list");
    if (typeof body.has_more !== "boolean") {
      throw new Error("Anthropic model catalog response had invalid pagination state");
    }
    models.push(...body.data);
    if (!body.has_more) return { sourceUrl: persistedSourceUrl(sourceUrl), models };
    if (typeof body.last_id !== "string" || !body.last_id.trim()) {
      throw new Error("Anthropic model catalog pagination missing cursor");
    }
    if (seen.has(body.last_id)) throw new Error("Anthropic model catalog repeated cursor");
    seen.add(body.last_id);
    cursor = body.last_id;
  }
  throw new Error("Anthropic model catalog pagination exceeded page limit");
}
