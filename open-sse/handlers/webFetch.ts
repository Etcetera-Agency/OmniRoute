/**
 * Web Fetch Handler
 *
 * Handles POST /v1/web/fetch requests.
 * Dispatches to configured web-fetch provider executors.
 *
 * Request format:
 * {
 *   "url": "https://example.com",
 *   "provider": "firecrawl" | "jina-reader" | "tavily-search",  // optional
 *   "format": "markdown" | "html" | "links" | "screenshot",
 *   "depth": 0 | 1 | 2,
 *   "wait_for_selector": "main",
 *   "include_metadata": true
 * }
 */

import { type WebFetchProviderId } from "../config/webFetchRegistry.ts";
import { runWebFetchChain } from "./webFetchChain.ts";

export type WebFetchFormat = "markdown" | "html" | "links" | "screenshot";

export interface WebFetchRequest {
  url: string;
  provider?: WebFetchProviderId;
  format?: WebFetchFormat;
  depth?: 0 | 1 | 2;
  wait_for_selector?: string;
  include_metadata?: boolean;
  fallback?: boolean;
  headers?: Headers;
  log?: WebFetchLogger;
}

export interface WebFetchResponse {
  provider: string;
  url: string;
  content: string;
  links: string[];
  metadata: { title: string | null; description: string | null } | null;
  screenshot_url: string | null;
}

export interface WebFetchResult {
  success: boolean;
  status?: number;
  error?: string;
  data?: WebFetchResponse;
}

export interface WebFetchCredentials {
  apiKey?: string;
  providerCredentials?: Partial<Record<WebFetchProviderId, { apiKey?: string }>>;
}

interface WebFetchLogger {
  info(tag: string, message: string, data?: unknown): void;
}

/**
 * Execute a web fetch request against the specified (or auto-selected) provider.
 *
 * Thin upstream-facing wrapper — the fork-specific provider chain, capability
 * filtering and fallback live in `webFetchChain.ts` to keep this file's diff vs
 * upstream OmniRoute minimal.
 *
 * @param req - Validated web fetch request body
 * @param credentials - Provider API credentials (apiKey)
 * @param resolvedProvider - Provider ID to use; if omitted auto-selects based on available creds
 */
export async function handleWebFetch(
  req: WebFetchRequest,
  credentials: WebFetchCredentials,
  resolvedProvider?: WebFetchProviderId
): Promise<WebFetchResult> {
  return runWebFetchChain(req, credentials, resolvedProvider);
}
