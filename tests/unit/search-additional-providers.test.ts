import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFirecrawlSearchRequest,
  buildParallelSearchRequest,
  normalizeFirecrawlSearchResponse,
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
