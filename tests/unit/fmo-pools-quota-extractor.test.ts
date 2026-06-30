import test from "node:test";
import assert from "node:assert/strict";

import {
  QUOTA_CLAIM_JSON_SCHEMA,
  QUOTA_RESEARCH_SYSTEM,
  renderQuotaResearchInput,
} from "../../src/lib/fmoPools/quotaResearchPrompt.ts";

test("quota-research prompt preserves FMO input contract", () => {
  const rendered = renderQuotaResearchInput({
    provider: "gemini",
    provider_model_id: "gemini/free",
    source_type: "search_summary",
    source_url: "https://example.com/quota",
    text: "Free tier allows 1,500 requests per day. https://example.com/quota",
    previous_limit: "unknown",
  });

  for (const field of [
    "provider",
    "provider_model_id",
    "source_type",
    "source_url",
    "previous_limit",
    "text",
  ]) {
    assert.match(rendered, new RegExp(`<${field}>\\n[\\s\\S]+\\n</${field}>`));
  }

  assert.match(QUOTA_RESEARCH_SYSTEM, /Use only the supplied text/);
  assert.match(QUOTA_RESEARCH_SYSTEM, /Prefer cumulative free-tier limits/);
  assert.match(QUOTA_RESEARCH_SYSTEM, /Return JSON only/);
});

test("quota claim schema describes FmoQuotaClaimResponse axes", () => {
  const schema = QUOTA_CLAIM_JSON_SCHEMA.schema as {
    required: string[];
    properties: Record<string, unknown>;
  };
  const axes = schema.properties.axes as {
    properties: Record<string, unknown>;
  };

  assert.equal(QUOTA_CLAIM_JSON_SCHEMA.name, "QuotaClaimResponse");
  assert.deepEqual(schema.required, ["usable", "axes", "sourceUrl"]);
  assert.deepEqual(Object.keys(axes.properties), [
    "requestsPerDay",
    "requestsPerMinute",
    "tokensPerDay",
    "tokensPerMonth",
    "resetAt",
  ]);
});
