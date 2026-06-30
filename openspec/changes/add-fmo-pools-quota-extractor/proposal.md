# Change: Implement the tier-3 quota-research LLM extractor

## Why

The planning slice (`add-fmo-pools-planning`) wired the tier-3 search-research path
end-to-end — query build, internal search chain, snapshot, deterministic validation —
**except the extraction step itself**. `extractQuotaClaimWithInternalLlm` in
`src/lib/fmoPools/quota.ts` is currently a stub that returns `null`, so
`searchResearchClaim` always returns `null` and every candidate with no live (tier-1)
and no static-catalog (tier-2) number falls straight through to tier-4 `none`. The
search is performed but its result is never read. Tier-3 is inert in production; only
the tail insures the gap.

This slice replaces that stub with the real net-new wiring already described (but not
built) in the planning slice's `design.md` ("Reuse vs net-new for the extractor"):
run the FMO `quota-research` contract through OmniRoute's own in-process LLM stack
(`handleChatCore`) with structured JSON output, parse the `QuotaClaimResponse`, and let
the existing `validateFmoQuotaClaimResponse` gate it. No FMO Python client, no FMO
Instructor runtime, no `POST /api/v1/search`, no OmniRoute HTTP route for extraction.

## What Changes

- `src/lib/fmoPools/quotaExtractor.ts` (net-new) — `runInternalChatPipeline` over
  `handleChatCore`: resolve the extractor model via `getModelInfo`, credentials via
  `getProviderCredentials`, build an OpenAI-shaped non-streaming body with a
  `response_format` JSON schema, call `handleChatCore`, read `result.response`, parse
  `choices[0].message.content` into a `FmoQuotaClaimResponse`.
- `src/lib/fmoPools/quotaResearchPrompt.ts` (net-new) — the `quota-research`
  system prompt + `renderQuotaResearchInput({provider, provider_model_id, source_type,
source_url, text, previous_limit})`, preserving the FMO contract.
- `src/lib/fmoPools/quota.ts` — replace the `extractQuotaClaimWithInternalLlm` stub
  with a thin call into `quotaExtractor.ts`; keep the same signature and `null`-on-fail
  contract so `searchResearchClaim` and `validateFmoQuotaClaimResponse` are unchanged.
- Make the extractor model and the whole tier-3 extraction independently disableable
  (config/flag) so a misconfigured extractor degrades to tier-4, never throws into the
  planning path.

## Impact

- **Capability**: `fmo-pool-rebalance` (adds a "Quota-research claim extraction"
  requirement that makes the previously high-level extraction step concrete and
  testable).
- **Reused**: `handleChatCore` (`open-sse/handlers/chatCore.ts`), `getModelInfo`
  (`src/sse/services/model.ts`), `getProviderCredentials` (`src/sse/services/auth.ts`),
  the request translators that honor `response_format`
  (`open-sse/translator/request/openai-to-claude.ts`, `.../openai-to-gemini.ts`),
  and the existing `summarizeFmoSearchResult` / `validateFmoQuotaClaimResponse`.
- **Net-new**: the in-process chat-pipeline wrapper (no existing one-off
  "ask the LLM once, get JSON" helper) and the OmniRoute-hosted `quota-research`
  prompt renderer.
- **Depends on**: `add-fmo-pools-planning` (the stub + snapshot + validation it fills
  in). **Unblocks**: trustworthy tier-3 quota coverage (less reliance on the tail).
