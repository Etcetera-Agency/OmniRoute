import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFirecrawlSearchRequest,
  buildGeminiGroundedSearchRequest,
  buildParallelSearchRequest,
  normalizeFirecrawlSearchResponse,
  normalizeGeminiGroundedSearchResponse,
  normalizeParallelSearchResponse,
} from "../../open-sse/handlers/search.ts";
import { SEARCH_PROVIDERS } from "../../open-sse/config/searchRegistry.ts";

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
    max_results: 3,
  });
});

test("firecrawl-search request builder sends v2 search shape", () => {
  const request = buildFirecrawlSearchRequest(SEARCH_PROVIDERS["firecrawl-search"], {
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
  });
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
  const web = normalizeFirecrawlSearchResponse(
    {
      data: {
        web: [
          {
            title: "Web",
            description: "Web description",
            url: "https://example.com/web",
            markdown: "# Web",
          },
        ],
      },
    },
    "query",
    "web"
  );
  const news = normalizeFirecrawlSearchResponse(
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
    "query",
    "news"
  );

  assert.equal(web.results[0].title, "Web");
  assert.equal(web.results[0].content?.format, "markdown");
  assert.equal(news.results.length, 1);
  assert.equal(news.results[0].published_at, "2026-06-01");
  assert.equal(news.results[0].citation.provider, "firecrawl-search");
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
