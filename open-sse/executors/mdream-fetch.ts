import { buildErrorBody, parseRetryAfterHeader } from "../utils/error.ts";
import type { WebFetchFormat, WebFetchResult } from "../handlers/webFetch.ts";
import { parseAndValidatePublicUrl } from "../../src/shared/network/outboundUrlGuard.ts";

const MDREAM_BASE_URL = "https://mdream.dev/";
const MDREAM_TIMEOUT_MS = 20_000;
// AICODE-NOTE: Use the fixed header set that returned hosted Markdown; never forward caller headers.
const MDREAM_HEADERS = {
  Accept: "text/markdown, text/plain;q=0.9",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://mdream.dev/",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};
const SENSITIVE_QUERY_NAMES = new Set([
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
  format?: WebFetchFormat;
  includeMetadata?: boolean;
}

function fail(status: number, message: string): WebFetchResult {
  const body = buildErrorBody(status, message);
  return { success: false, status, error: body.error.message };
}

export async function mdreamFetch({
  url,
  format = "markdown",
  includeMetadata = false,
}: MdreamFetchOptions): Promise<WebFetchResult> {
  if (format !== "markdown") return fail(400, "Mdream only supports Markdown output");

  let target: URL;
  try {
    target = parseAndValidatePublicUrl(url);
  } catch {
    return fail(400, "Mdream requires a public HTTPS URL");
  }

  if (target.protocol !== "https:") {
    return fail(400, "Mdream requires a public HTTPS URL");
  }

  if (
    [...target.searchParams.keys()].some((name) => SENSITIVE_QUERY_NAMES.has(name.toLowerCase()))
  ) {
    return fail(400, "Mdream does not accept secret-bearing query parameters");
  }

  const upstreamUrl = new URL(`${target.host}${target.pathname}${target.search}`, MDREAM_BASE_URL);
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MDREAM_TIMEOUT_MS);

  try {
    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: MDREAM_HEADERS,
      signal: controller.signal,
    });

    if (!response.ok) {
      const result = fail(response.status, "Mdream request failed");
      if (response.status === 429) result.retryAfter = parseRetryAfterHeader(response.headers);
      return result;
    }

    const content = (await response.text()).trim();
    if (!content) return fail(502, "Mdream returned empty content");

    return {
      success: true,
      data: {
        provider: "mdream",
        url,
        content,
        links: [],
        metadata: includeMetadata ? { title: null, description: null } : null,
        screenshot_url: null,
      },
    };
  } catch {
    return timedOut ? fail(504, "Mdream request timed out") : fail(502, "Mdream request failed");
  } finally {
    clearTimeout(timeoutId);
  }
}
