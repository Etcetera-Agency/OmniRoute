import { buildErrorBody, sanitizeErrorMessage } from "../utils/error.ts";
import type { WebFetchCredentials, WebFetchFormat, WebFetchResult } from "../handlers/webFetch.ts";

const PARALLEL_EXTRACT_URL = "https://api.parallel.ai/v1/extract";
const PARALLEL_TIMEOUT_MS = 30_000;

interface ParallelExtractOptions {
  url: string;
  format: WebFetchFormat;
  includeMetadata: boolean;
  credentials: WebFetchCredentials;
}

function normalizeParallelContent(result: Record<string, unknown>): string {
  if (typeof result.full_content === "string" && result.full_content.trim()) {
    return result.full_content.trim();
  }
  const excerpts = Array.isArray(result.excerpts)
    ? result.excerpts.filter((item): item is string => typeof item === "string" && item.trim())
    : [];
  return excerpts.join("\n\n").trim();
}

export async function parallelExtractFetch(opts: ParallelExtractOptions): Promise<WebFetchResult> {
  const { url, format, includeMetadata, credentials } = opts;

  if (!credentials.apiKey) {
    const body = buildErrorBody(401, "Parallel API key required");
    return { success: false, status: 401, error: body.error.message };
  }
  if (format !== "markdown" && format !== "html") {
    const body = buildErrorBody(400, `Parallel Extract does not support ${format} output`);
    return { success: false, status: 400, error: body.error.message };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PARALLEL_TIMEOUT_MS);

  try {
    const response = await fetch(PARALLEL_EXTRACT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": credentials.apiKey,
      },
      body: JSON.stringify({
        urls: [url],
        objective: "Extract the main page content for LLM grounding.",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawError = await response.text().catch(() => `HTTP ${response.status}`);
      const message = sanitizeErrorMessage(
        `Parallel Extract error ${response.status}: ${rawError}`
      );
      const body = buildErrorBody(response.status, message);
      return { success: false, status: response.status, error: body.error.message };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const results = Array.isArray(data.results) ? data.results : [];
    const firstResult = (results[0] as Record<string, unknown> | undefined) ?? {};
    const content = normalizeParallelContent(firstResult);

    if (!content) {
      const body = buildErrorBody(502, "Parallel Extract returned empty content");
      return { success: false, status: 502, error: body.error.message };
    }

    return {
      success: true,
      data: {
        provider: "parallel-extract",
        url,
        content,
        links: [],
        metadata: includeMetadata
          ? {
              title: firstResult.title != null ? String(firstResult.title) : null,
              description: null,
            }
          : null,
        screenshot_url: null,
      },
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      const body = buildErrorBody(504, "Parallel Extract request timed out");
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
