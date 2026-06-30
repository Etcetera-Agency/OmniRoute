import test from "node:test";
import assert from "node:assert/strict";

import {
  QUOTA_CLAIM_JSON_SCHEMA,
  QUOTA_RESEARCH_SYSTEM,
  renderQuotaResearchInput,
} from "../../src/lib/fmoPools/quotaResearchPrompt.ts";
import {
  isQuotaExtractorEnabled,
  parseQuotaClaim,
  runInternalChatPipeline,
  selectExtractorModel,
  type QuotaExtractorDeps,
} from "../../src/lib/fmoPools/quotaExtractor.ts";

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

function makeDeps(content: string, ok = true): QuotaExtractorDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getModelInfo: async (modelStr) => {
      calls.push(`model:${modelStr}`);
      return { provider: "gemini", model: "gemini-2.5-flash-lite" };
    },
    getProviderCredentials: async (providerId) => {
      calls.push(`credentials:${providerId}`);
      return { apiKey: "redacted" };
    },
    handleChatCore: async ({ body }) => {
      calls.push(`chat:${String(body.model)}`);
      return {
        response: new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
          }),
          { status: ok ? 200 : 500 }
        ),
      };
    },
    isEnabled: () => true,
    selectExtractorModel: () => "gemini/gemini-2.5-flash-lite",
  };
}

test("parseQuotaClaim tolerates JSON fences and rejects invalid shapes", () => {
  assert.deepEqual(
    parseQuotaClaim(
      '```json\n{"usable":true,"axes":{"requestsPerDay":1500},"sourceUrl":"https://example.com"}\n```'
    ),
    {
      usable: true,
      axes: { requestsPerDay: 1500 },
      sourceUrl: "https://example.com",
    }
  );
  assert.equal(parseQuotaClaim("```json\nnot-json\n```"), null);
  assert.equal(parseQuotaClaim('{"usable":true,"axes":{},"sourceUrl":42}'), null);
});

test("runInternalChatPipeline resolves model and credentials before parsing response content", async () => {
  const deps = makeDeps(
    JSON.stringify({
      usable: true,
      axes: { tokensPerMonth: 1_000_000 },
      sourceUrl: "https://example.com/quota",
      rationale: "source says free monthly tokens",
    })
  );

  const claim = await runInternalChatPipeline(
    {
      provider: "gemini",
      provider_model_id: "gemini/free",
      source_type: "search_summary",
      source_url: "https://example.com/quota",
      text: "Free monthly limit is 1,000,000 tokens. https://example.com/quota",
      previous_limit: "unknown",
    },
    deps
  );

  assert.deepEqual(deps.calls, [
    "model:gemini/gemini-2.5-flash-lite",
    "credentials:gemini",
    "chat:gemini/gemini-2.5-flash-lite",
  ]);
  assert.deepEqual(claim?.axes, { tokensPerMonth: 1_000_000 });
});

test("runInternalChatPipeline returns null for disabled, non-ok, and non-json responses", async () => {
  const disabled = makeDeps("{}");
  disabled.isEnabled = () => false;
  assert.equal(
    await runInternalChatPipeline(
      {
        provider: "gemini",
        provider_model_id: "gemini/free",
        source_type: "search_summary",
        source_url: "https://example.com/quota",
        text: "no call",
        previous_limit: "unknown",
      },
      disabled
    ),
    null
  );
  assert.deepEqual(disabled.calls, []);

  const nonOk = makeDeps("{}", false);
  assert.equal(
    await runInternalChatPipeline(
      {
        provider: "gemini",
        provider_model_id: "gemini/free",
        source_type: "search_summary",
        source_url: "https://example.com/quota",
        text: "non-ok",
        previous_limit: "unknown",
      },
      nonOk
    ),
    null
  );

  const nonJson = makeDeps("not-json");
  assert.equal(
    await runInternalChatPipeline(
      {
        provider: "gemini",
        provider_model_id: "gemini/free",
        source_type: "search_summary",
        source_url: "https://example.com/quota",
        text: "non-json",
        previous_limit: "unknown",
      },
      nonJson
    ),
    null
  );
});

test("quota extractor env config selects model and disable flag", () => {
  const originalEnabled = process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_ENABLED;
  const originalModel = process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_MODEL;
  try {
    delete process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_ENABLED;
    delete process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_MODEL;
    assert.equal(isQuotaExtractorEnabled(), true);
    assert.equal(selectExtractorModel(), "gemini/gemini-2.5-flash-lite");

    process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_ENABLED = "false";
    process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_MODEL = "codex/codex-mini";
    assert.equal(isQuotaExtractorEnabled(), false);
    assert.equal(selectExtractorModel(), "codex/codex-mini");
  } finally {
    if (originalEnabled === undefined) delete process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_ENABLED;
    else process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_ENABLED = originalEnabled;
    if (originalModel === undefined) delete process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_MODEL;
    else process.env.OMNIROUTE_FMO_QUOTA_EXTRACTOR_MODEL = originalModel;
  }
});
