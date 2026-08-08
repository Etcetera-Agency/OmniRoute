import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGeminiGroundedSearchRequest,
  buildParallelSearchRequest,
  normalizeGeminiGroundedSearchResponse,
  normalizeParallelSearchResponse,
} from "../../open-sse/handlers/search.ts";
import {
  buildFirecrawlSearchRequest as buildSharedFirecrawlSearchRequest,
  normalizeFirecrawlSearchResponse as normalizeSharedFirecrawlSearchResponse,
} from "../../open-sse/handlers/search/firecrawlSearch.ts";
import { SEARCH_PROVIDERS } from "../../src/lib/search/providerRegistry.ts";
import { searchResultSchema, v1SearchSchema } from "../../src/shared/validation/schemas.ts";

type TestFirecrawlHit = {
  title?: string;
  url?: string;
  snippet?: string;
  full_text?: string;
  text_format?: string;
  source_type?: string;
  published_at?: string | null;
};

test("parallel-search request builder sends current v1 search shape", () => {
  const request = buildParallelSearchRequest(SEARCH_PROVIDERS["parallel-search"], {
    query: "agent search",
    searchType: "web",
    maxResults: 3,
    token: "parallel-key",
  });

  assert.equal(request.url, "https://api.parallel.ai/v1/search");
  assert.equal(request.init.method, "POST");
  assert.equal((request.init.headers as Record<string, string>)["x-api-key"], "parallel-key");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    objective: "agent search",
    search_queries: ["agent search"],
  });
});

test("firecrawl-search request builder sends v2 search shape", () => {
  const request = buildSharedFirecrawlSearchRequest(SEARCH_PROVIDERS["firecrawl-search"], {
    query: "agent news",
    searchType: "news",
    maxResults: 4,
    token: "firecrawl-key",
    country: "us",
    timeRange: "day",
    domainFilter: ["example.com", "-blocked.example"],
  });

  assert.equal(request.url, "https://api.firecrawl.dev/v2/search");
  assert.equal(request.init.method, "POST");
  assert.equal(
    (request.init.headers as Record<string, string>).Authorization,
    "Bearer firecrawl-key"
  );
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    query: "agent news",
    limit: 4,
    sources: ["news"],
    ignoreInvalidURLs: true,
    includeDomains: ["example.com"],
    excludeDomains: ["blocked.example"],
    country: "US",
    tbs: "qdr:d",
    scrapeOptionsFromContent: true,
  });
});

test("firecrawl aliases share native helper while preserving variant body and metadata", () => {
  const canonical = buildSharedFirecrawlSearchRequest(SEARCH_PROVIDERS.firecrawl, {
    query: "canonical",
    searchType: "web",
    maxResults: 2,
    token: "canonical-key",
    country: "us",
  });
  const alias = buildSharedFirecrawlSearchRequest(SEARCH_PROVIDERS["firecrawl-search"], {
    query: "alias",
    searchType: "web",
    maxResults: 2,
    token: "alias-key",
    country: "us",
    contentOptions: { full_page: true, format: "markdown" },
  });

  const canonicalBody = JSON.parse(String(canonical.init.body));
  const aliasBody = JSON.parse(String(alias.init.body));
  assert.equal(canonicalBody.ignoreInvalidURLs, undefined);
  assert.equal(canonicalBody.scrapeOptionsFromContent, undefined);
  assert.equal(canonicalBody.country, "us");
  assert.equal(aliasBody.ignoreInvalidURLs, true);
  assert.equal(aliasBody.scrapeOptionsFromContent, true);
  assert.equal(aliasBody.country, "US");
  assert.deepEqual(aliasBody.scrapeOptions, { formats: [{ type: "markdown" }] });
  assert.equal(SEARCH_PROVIDERS.firecrawl.timeoutMs, 30_000);
  assert.equal(SEARCH_PROVIDERS["firecrawl-search"].timeoutMs, 60_000);
  assert.equal(SEARCH_PROVIDERS.firecrawl.freeMonthlyQuota, 1000);
  assert.equal(SEARCH_PROVIDERS["firecrawl-search"].freeMonthlyQuota, 500);
  assert.equal(v1SearchSchema.safeParse({ query: "q", provider: "firecrawl" }).success, true);
  assert.equal(
    v1SearchSchema.safeParse({ query: "q", provider: "firecrawl-search" }).success,
    true
  );
});

test("gemini-grounded-search request builder enables Google Search grounding", () => {
  const request = buildGeminiGroundedSearchRequest(SEARCH_PROVIDERS["gemini-grounded-search"], {
    query: "OpenAI official website",
    searchType: "web",
    maxResults: 3,
    token: "gemini-key",
    providerOptions: { model: "gemini-test-model" },
  });
  const body = JSON.parse(String(request.init.body));

  assert.equal(
    request.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent"
  );
  assert.equal(request.model, "gemini-test-model");
  assert.equal((request.init.headers as Record<string, string>)["x-goog-api-key"], "gemini-key");
  assert.deepEqual(body.tools, [{ googleSearch: {} }]);
  assert.match(body.contents[0].parts[0].text, /OpenAI official website/);
});

test("parallel-search normalizer drops invalid URL results", () => {
  const normalized = normalizeParallelSearchResponse(
    {
      results: [
        {
          title: "Good",
          url: "https://example.com/good",
          publish_date: "2026-06-01",
          excerpts: ["First", "Second"],
        },
        { title: "Missing URL", excerpts: ["Drop"] },
        { title: "Bad URL", url: "not-a-url", excerpts: ["Drop"] },
      ],
    },
    "query",
    "web"
  );

  assert.equal(normalized.results.length, 1);
  assert.equal(normalized.results[0].title, "Good");
  assert.equal(normalized.results[0].snippet, "First\n\nSecond");
  assert.equal(normalized.results[0].citation.provider, "parallel-search");
});

test("firecrawl-search normalizer handles web and news arrays", () => {
  const makeResult = (providerId: string, item: TestFirecrawlHit, idx: number, now: string) => ({
    providerId,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    content: item.full_text ? { format: item.text_format, text: item.full_text } : null,
    source_type: item.source_type,
    published_at: item.published_at,
    citation: { provider: providerId },
    idx,
    now,
  });
  const web = normalizeSharedFirecrawlSearchResponse(
    {
      data: {
        web: [
          {
            title: "Web",
            description: "Web description",
            url: "https://example.com/web",
            markdown: "# Web",
            category: "docs",
          },
        ],
      },
    },
    "web",
    makeResult,
    {
      providerId: "firecrawl-search",
      invalidUrlPolicy: "drop",
      citationProvider: "firecrawl-search",
    }
  );
  const news = normalizeSharedFirecrawlSearchResponse(
    {
      data: {
        news: [
          {
            title: "News",
            snippet: "News snippet",
            url: "https://example.com/news",
            date: "2026-06-01",
          },
          { title: "Missing URL", snippet: "Drop" },
        ],
      },
    },
    "news",
    makeResult,
    {
      providerId: "firecrawl-search",
      invalidUrlPolicy: "drop",
      citationProvider: "firecrawl-search",
    }
  );

  assert.equal(web.results[0].title, "Web");
  assert.equal(web.results[0].content?.format, "markdown");
  assert.equal(web.results[0].source_type, "other");
  assert.equal(news.results.length, 1);
  assert.equal(news.results[0].published_at, "2026-06-01");
  assert.equal(news.results[0].citation.provider, "firecrawl-search");
});

test("shared Firecrawl normalizer keeps canonical URLs and drops alias invalid URLs", () => {
  const envelope = {
    data: {
      web: [
        { title: "Canonical", url: "not-a-url", description: "preserve" },
        { title: "Alias", url: "https://example.com/ok", description: "keep" },
      ],
    },
  };
  const makeResult = (providerId: string, item: TestFirecrawlHit, idx: number, now: string) => ({
    providerId,
    url: item.url,
    position: idx + 1,
    now,
  });

  const canonical = normalizeSharedFirecrawlSearchResponse(envelope, "web", makeResult, {
    providerId: "firecrawl",
    invalidUrlPolicy: "preserve",
    citationProvider: "firecrawl",
  });
  const alias = normalizeSharedFirecrawlSearchResponse(envelope, "web", makeResult, {
    providerId: "firecrawl-search",
    invalidUrlPolicy: "drop",
    citationProvider: "firecrawl-search",
  });

  assert.equal(canonical.results.length, 2);
  assert.equal(alias.results.length, 1);
  assert.equal(alias.results[0].providerId, "firecrawl-search");
  assert.equal(alias.results[0].url, "https://example.com/ok");
});

test("shared Firecrawl normalizer preserves alias HTML content as schema-valid text", () => {
  const normalized = normalizeSharedFirecrawlSearchResponse(
    {
      data: {
        web: [
          {
            title: "HTML page",
            url: "https://example.com/html",
            html: "<p>Rendered page</p>",
            category: "docs",
          },
          {
            title: "Categoriless page",
            url: "https://example.com/no-category",
            html: "<p>Web page</p>",
          },
        ],
      },
    },
    "web",
    (providerId, item, idx, now) => ({
      title: item.title || "",
      url: item.url || "",
      snippet: item.snippet || "",
      position: idx + 1,
      score: null,
      published_at: item.published_at || null,
      favicon_url: null,
      content: item.full_text
        ? { format: item.text_format, text: item.full_text, length: item.full_text.length }
        : null,
      metadata: {
        author: null,
        language: null,
        source_type: item.source_type || null,
        image_url: item.image_url || null,
      },
      citation: { provider: providerId, retrieved_at: now, rank: idx + 1 },
      provider_raw: null,
    }),
    {
      providerId: "firecrawl-search",
      invalidUrlPolicy: "drop",
      citationProvider: "firecrawl-search",
    }
  );

  const parsedCategory = searchResultSchema.safeParse(normalized.results[0]);
  const parsedWebFallback = searchResultSchema.safeParse(normalized.results[1]);
  assert.equal(parsedCategory.success, true);
  assert.equal(parsedWebFallback.success, true);
  assert.equal(parsedCategory.success ? parsedCategory.data.content?.format : null, "text");
  assert.equal(parsedCategory.success ? parsedCategory.data.metadata?.source_type : null, "other");
  assert.equal(
    parsedWebFallback.success ? parsedWebFallback.data.metadata?.source_type : null,
    "other"
  );
});

test("gemini-grounded-search normalizer maps answer and deduped grounding chunks", () => {
  const normalized = normalizeGeminiGroundedSearchResponse(
    {
      candidates: [
        {
          content: { parts: [{ text: "Gemini answer text" }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://example.com/path#section", title: "Example" } },
              { web: { uri: "https://example.com/path", title: "Duplicate" } },
              { web: { uri: "ftp://example.com/file", title: "Invalid" } },
              { web: { title: "Missing URL" } },
            ],
          },
        },
      ],
    },
    "query",
    "web",
    "gemini-test-model"
  );

  assert.equal(normalized.results.length, 1);
  assert.equal(normalized.results[0].title, "Example");
  assert.equal(normalized.results[0].url, "https://example.com/path#section");
  assert.equal(normalized.results[0].snippet, "Gemini answer text");
  assert.equal(normalized.results[0].citation.provider, "gemini-grounded-search");
  assert.deepEqual(normalized.answer, {
    source: "gemini-grounded-search",
    text: "Gemini answer text",
    model: "gemini-test-model",
  });
});
