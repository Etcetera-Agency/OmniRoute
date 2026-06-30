# Design: tier-3 quota-research LLM extractor

## Context

`add-fmo-pools-planning` shipped tier-3 search-research with the extraction step
stubbed:

```ts
// src/lib/fmoPools/quota.ts (current)
export async function extractQuotaClaimWithInternalLlm(
  _input
): Promise<FmoQuotaClaimResponse | null> {
  return null; // <- stub: tier-3 always yields no claim
}
```

Everything around it already exists and stays as-is:

- `runFmoQuotaSearch` → `buildSearchAttempts` + `runSearchChain` (gemini-grounded-search,
  429 → auto-routing) → `summarizeFmoSearchResult` ⇒ `FmoSearchSnapshot`.
- `validateFmoQuotaClaimResponse(claim, snapshot)` — deterministic gate (usable flag,
  `sourceUrl` ∈ evidence, axis presence).
- `searchResearchClaim(candidate)` — orchestrates query → search → extract → validate →
  `{ tier: 3, axes, source: "search-research", searchSnapshot }`.

This slice only fills the hole: turn the snapshot text into a `QuotaClaimResponse` via
OmniRoute's in-process LLM stack.

## Why net-new (no existing helper)

There is no in-process "ask the LLM once and get JSON" primitive. Every current
`handleChatCore` caller (`open-sse/services/combo.ts`,
`open-sse/services/autoCombo/pipelineRouter.ts`, `src/sse/handlers/chatHelpers.ts`)
invokes it while serving a live request with `body`/`modelInfo`/`credentials` already
assembled. `handleChatCore({ body, modelInfo, credentials, log })` returns
`{ response: Response, ... }`; with `stream: false` that `Response` carries a JSON
body. So the extractor must assemble the request itself and read the `Response` back.

## Module shape

```ts
// src/lib/fmoPools/quotaResearchPrompt.ts
export const QUOTA_RESEARCH_SYSTEM: string; // FMO quota-research contract, hosted in OmniRoute
export function renderQuotaResearchInput(input: {
  provider: string;
  provider_model_id: string;
  source_type: string;
  source_url: string;
  text: string;
  previous_limit: string;
}): string;

export const QUOTA_CLAIM_JSON_SCHEMA: object; // json_schema for FmoQuotaClaimResponse
```

```ts
// src/lib/fmoPools/quotaExtractor.ts
export interface QuotaExtractorDeps {
  getModelInfo(modelStr: string): Promise<ModelInfo>;
  getProviderCredentials(providerId: string): Promise<unknown>;
  handleChatCore(args): Promise<{ response: Response }>;
  isEnabled(): boolean; // config flag; false => no-claim
  selectExtractorModel(): string; // e.g. a cheap, JSON-reliable free model id
}

export async function runInternalChatPipeline(
  input: QuotaResearchInput,
  deps: QuotaExtractorDeps
): Promise<FmoQuotaClaimResponse | null> {
  if (!deps.isEnabled()) return null;
  const modelStr = deps.selectExtractorModel();
  const modelInfo = await deps.getModelInfo(modelStr);
  const credentials = await deps.getProviderCredentials(modelInfo.provider);

  const body = {
    model: modelStr,
    stream: false,
    temperature: 0,
    messages: [
      { role: "system", content: QUOTA_RESEARCH_SYSTEM },
      { role: "user", content: renderQuotaResearchInput(input) },
    ],
    response_format: { type: "json_schema", json_schema: QUOTA_CLAIM_JSON_SCHEMA },
  };

  const { response } = await deps.handleChatCore({ body, modelInfo, credentials, log });
  if (!response.ok) return null;
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  return parseQuotaClaim(content); // tolerant parse; null on any failure
}
```

```ts
// src/lib/fmoPools/quota.ts (replaces the stub body only; signature unchanged)
export async function extractQuotaClaimWithInternalLlm(
  input
): Promise<FmoQuotaClaimResponse | null> {
  return runInternalChatPipeline(input, defaultQuotaExtractorDeps).catch(() => null);
}
```

## Contract preserved from FMO

`renderQuotaResearchInput` passes exactly `provider`, `provider_model_id`,
`source_type`, `source_url`, `text`, `previous_limit`. `QUOTA_RESEARCH_SYSTEM` keeps
the FMO `quota-research` rules verbatim in spirit: use supplied text only, never guess,
require evidence for every limit, prefer cumulative daily/monthly axes over RPM/TPM when
present, pick range values by `previous_limit`, reject unusable claims. The model's job
is extraction only — the deterministic gate stays in `validateFmoQuotaClaimResponse`,
which this slice does not touch.

## response_format honoring

`response_format`/`json_schema` is translated per provider
(`open-sse/translator/request/openai-to-claude.ts` injects schema into the system
prompt; `.../openai-to-gemini.ts` maps to `responseMimeType`/`responseSchema`). The
extractor therefore does not assume a provider-native JSON mode; it relies on the
translator layer and still defends with a tolerant `parseQuotaClaim` (strip code
fences, `JSON.parse`, shape-check) that returns `null` on any deviation.

## Failure & disable semantics

- `isEnabled() === false`, non-`ok` response, empty/unparseable content, or
  schema-invalid claim ⇒ return `null`. `searchResearchClaim` then returns `null` and
  `resolveFmoQuota` falls to tier-4 `none`.
- The whole call is wrapped so no extractor error escapes into planning; the tail
  insures the resulting gap exactly as today.
- The `FmoSearchSnapshot` is attached on the tier-3 result by `searchResearchClaim`
  before extraction, so it survives a null claim for the debug surface.

## Testing

Inject `QuotaExtractorDeps` with a fake `handleChatCore`:

1. Fake returns a well-formed JSON `Response` ⇒ `runInternalChatPipeline` yields a
   parsed `FmoQuotaClaimResponse`; assert it then passes `validateFmoQuotaClaimResponse`
   and `searchResearchClaim` returns `{ tier: 3, source: "search-research", ... }`.
2. Fake `getModelInfo`/`getProviderCredentials` are called; assert no route `Request`
   is constructed and `POST /api/v1/search` is never hit (no `fetch`).
3. Fake returns non-`ok` / non-JSON / fenced-but-invalid ⇒ `null`, tier-4, no throw.
4. `isEnabled() === false` ⇒ `handleChatCore` not invoked, `null`, tier-4.
