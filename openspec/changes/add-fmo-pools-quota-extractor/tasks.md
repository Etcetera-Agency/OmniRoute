# Implementation Tasks

- [x] `src/lib/fmoPools/quotaResearchPrompt.ts` — host the FMO `quota-research` system
      prompt in OmniRoute and `renderQuotaResearchInput({provider, provider_model_id,
source_type, source_url, text, previous_limit})`; preserve the FMO contract (supplied
      text only, never guess, require evidence, cumulative-over-RPM, range-by-previous-limit,
      reject unusable). Export `QUOTA_CLAIM_JSON_SCHEMA` for `FmoQuotaClaimResponse`.
- [x] `src/lib/fmoPools/quotaExtractor.ts` — `runInternalChatPipeline(input, deps)`:
      resolve model via `getModelInfo`, credentials via `getProviderCredentials`, build a
      non-streaming OpenAI-shaped `body` with `temperature: 0` and the `response_format`
      json_schema, call `handleChatCore`, read `result.response`, parse
      `choices[0].message.content`. Inject all four collaborators via a `QuotaExtractorDeps`
      interface for testability.
- [x] Tolerant `parseQuotaClaim(content)` — strip code fences, `JSON.parse`, shape-check
      against `FmoQuotaClaimResponse`; return `null` on any deviation. Never throw.
- [x] `selectExtractorModel()` — pick a cheap, JSON-reliable model id for extraction;
      keep it configurable. `isEnabled()` flag gates the whole step (disabled ⇒ no-claim).
- [ ] `src/lib/fmoPools/quota.ts` — replace the `extractQuotaClaimWithInternalLlm` stub
      body with a `.catch(() => null)`-wrapped call into `runInternalChatPipeline`; keep the
      signature and the `null`-on-fail contract so `searchResearchClaim` and
      `validateFmoQuotaClaimResponse` are unchanged.
- [ ] Confirm `response_format` reaches both the Claude and Gemini translators
      unchanged; do not assume provider-native JSON mode.
- [ ] Tests (`tests/unit/fmo-pools-quota-extractor.test.ts`): well-formed JSON ⇒ parsed
      claim that then validates and yields a tier-3 result; `getModelInfo`/
      `getProviderCredentials` invoked and no route `Request`/`fetch`/`POST /api/v1/search`;
      non-`ok`/non-JSON/fenced-invalid ⇒ `null` + tier-4 + no throw; `isEnabled() === false`
      ⇒ `handleChatCore` not called + tier-4; snapshot retained on the result either way.
- [ ] Update `add-fmo-pools-planning` follow-through note (or this change's archive) so
      the previously `[x]` extraction task is no longer represented by a stub.
