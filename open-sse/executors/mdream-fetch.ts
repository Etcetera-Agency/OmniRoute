import { parseAndValidatePublicUrl } from "@/shared/network/outboundUrlGuard";
import { buildErrorBody, sanitizeErrorMessage } from "../utils/error.ts";
import type { WebFetchFormat, WebFetchResult } from "../handlers/webFetch.ts";

const MDREAM_BASE_URL = "https://mdream.dev";
const MDREAM_TIMEOUT_MS = 20_000;
const SECRET_QUERY_KEYS = new Set([
  "token",
  "api_key",
  "apikey",
  "key",
  "signature",
  "session",
  "auth",
  "code",
]);

interface MdreamFetchOptions {
  url: string;
  format: WebFetchFormat;
  includeMetadata: boolean;
  headers?: Headers;
}

export function buildMdreamFetchUrl(inputUrl: string): string {
  const parsed = new URL(inputUrl);
  return `${MDREAM_BASE_URL}/${parsed.host}${parsed.pathname}${parsed.search}`;
}

function hasSecretQuery(parsed: URL): boolean {
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase())) return true;
  }
  return false;
}

function validateMdreamRequest(opts: MdreamFetchOptions): void {
  const parsed = parseAndValidatePublicUrl(opts.url);

  if (opts.format !== "markdown") {
    throw new Error("Mdream supports markdown fetches only");
  }
  if (hasSecretQuery(parsed)) {
    throw new Error("Mdream rejected secret-bearing URL");
  }
  if (opts.headers?.has("authorization") || opts.headers?.has("cookie")) {
    throw new Error("Mdream rejected authorized or cookie-bearing request");
  }
  if (opts.headers?.get("x-hermes-data-class") === "sensitive-health") {
    throw new Error("Mdream rejected sensitive-health URL");
  }
}

export async function mdreamFetch(opts: MdreamFetchOptions): Promise<WebFetchResult> {
  try {
    validateMdreamRequest(opts);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const body = buildErrorBody(400, sanitizeErrorMessage(message));
    return { success: false, status: 400, error: body.error.message };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MDREAM_TIMEOUT_MS);

  try {
    const response = await fetch(buildMdreamFetchUrl(opts.url), {
      method: "GET",
      headers: { Accept: "text/markdown, text/plain;q=0.9" },
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawError = await response.text().catch(() => `HTTP ${response.status}`);
      const message = sanitizeErrorMessage(`Mdream error ${response.status}: ${rawError}`);
      const body = buildErrorBody(response.status, message);
      return { success: false, status: response.status, error: body.error.message };
    }

    const content = (await response.text()).trim();
    if (!content) {
      const body = buildErrorBody(502, "Mdream returned empty content");
      return { success: false, status: 502, error: body.error.message };
    }

    return {
      success: true,
      data: {
        provider: "mdream",
        url: opts.url,
        content,
        links: [],
        metadata: opts.includeMetadata ? { title: null, description: null } : null,
        screenshot_url: null,
      },
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      const body = buildErrorBody(504, "Mdream request timed out");
      return { success: false, status: 504, error: body.error.message };
    }
    const message =
      err instanceof Error ? sanitizeErrorMessage(err.message) : sanitizeErrorMessage(String(err));
    const body = buildErrorBody(502, message);
    return { success: false, status: 502, error: body.error.message };
  } finally {
    clearTimeout(timeoutId);
  }
}
