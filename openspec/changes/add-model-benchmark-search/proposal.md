# Change: Search benchmark evidence for newly synced models

## Why

The runtime reads a frozen benchmark score map. A successful models.dev sync
adds model identities and capability rows, but it does not discover benchmark
evidence for those identities. As a result, a newly introduced model can remain
unrated indefinitely even when public benchmark records exist.

The refresh must detect newly observed exact model IDs, establish whether each
one is already present in Artificial Analysis or the reviewed official
SWE-bench, Terminal-Bench, and DeepSWE source set, then search Hugging Face
evaluation metadata and public web results only when all those source checks
completed and both the AA and official checks found no exact match. Each
attempt must leave a durable receipt that can be inspected and retried after a
restart.

## What changes

- After a successful, non-dry-run models.dev capability sync, compare the new
  raw model IDs with the previously persisted `model_capabilities` snapshot.
  The first non-empty snapshot establishes the baseline; it does not enqueue
  every catalog model. Persist later new identities before replacing that
  snapshot so an interrupted refresh remains recoverable.
- Add an idempotent, durable queue and raw-evidence store for model identity,
  run state, source status, errors, source URLs/versions/dates, exact matching
  records, reasoning effort/configuration when the source reports them, and
  raw search results.
- Keep drains live under slow or interrupted work: claim one row at a time,
  persist its outcome before claiming another, bound strict-SO inference, and
  schedule stale-running recovery independently of the daily models.dev sync.
- Refresh the bounded source set: AA Free language-model pages; the existing
  official SWE-bench, Terminal-Bench 2.0, Terminal-Bench 2.1, and DeepSWE
  endpoints; Hugging Face Hub model eval metadata; and `/v1/search` with the
  explicitly selected, configured zero-cost `ollama-search` provider and no
  alternate. Resolve its Ollama Cloud credential through the existing search
  execution service; never pass empty credentials to the provider handler.
- Search HF and Ollama Web Search only after a complete exact-match miss in both AA
  and all configured official leaderboards. Preserve candidates for review;
  do not publish any score into the frozen map, benchmark consensus, or model
  capability fitness.
- Fail closed unless the provider registry reports zero query cost and the
  result reports provider `ollama-search` with `search_cost_usd=0`. Its current
  catalog quota is 1,000 requests/month; no paid provider may be selected as
  fallback.
- Keep missing or unverified evidence pending/unrated. Missing effort stays
  null. Store source-reported numbers only as raw evidence, never as calibrated
  scores.
- Add an authenticated read endpoint for the durable run and evidence records.

## Structured-output boundary

After `/v1/search` returns results, submit those results to one exact model
through server-enforced Structured Output (SO). Use
`xingchen-agi/xing4.0-29b-a4b:free` on its OpenRouter Phala endpoint only. Before
each call, verify OpenRouter still reports exactly one matching Phala endpoint,
zero input/output price, and support for `response_format` plus
`structured_outputs`; also require an active local OpenRouter connection whose
synced catalog marks that exact model free. Pin that connection and send a
strict JSON Schema request with OpenRouter provider restricted to `phala`,
`require_parameters: true`, and `allow_fallbacks: false`.

The one-shot dispatch bypasses combo routing, retry, account rotation, and
global/emergency fallback. If any live metadata, local connection, internal
key, request, or response validation gate fails, record the blocked/error
state and leave the model unrated. Accept output only when its model identity,
source URL, quoted source text, benchmark fields, and values match the returned
search material. Accepted output remains candidate-review-required; it never
updates the frozen score map. Do not use another model, provider, JSON mode,
or paid/out-of-band route as fallback.

## Non-goals

- No benchmark score normalization/calibration, frozen-map regeneration, or
  automatic rating write.
- No change to auto bands, free-tier routing, feature flags, provider settings,
  periodic-sync cadence, or live service configuration.
- No paid inference, provider auto-selection, fallback bands, zero-fill, fuzzy
  identity aliases, or score inference from search snippets. Free strict-SO
  extraction only creates review-required evidence and cannot publish ratings.

## Acceptance

- A later successful models.dev sync detects a newly persisted raw model ID,
  writes exactly one durable search row, and starts the bounded source refresh.
- A slow model run cannot mark untouched rows `running`; each completed or
  timed-out row has a durable outcome before the next row is claimed. A fresh
  `running` row left by restart is retried once it reaches the stale threshold,
  without waiting for the next daily sync.
- Repeated syncs and retries do not duplicate model events or evidence.
- AA and each official source have an independent status. A failed, truncated,
  or malformed source is an error/incomplete result and never proves absence.
- HF and explicit zero-cost Ollama Search run only for exact missing-in-both
  identities; a configured credential is required and no alternate provider
  may run.
- Evidence includes exact model identity and source provenance; reasoning
  effort/config is null when the source does not provide it.
- Pending, errored, and review-required records cannot alter production score
  files or the `benchmark_consensus` source.
- Focused RED/GREEN tests cover sync-trigger conditions, exact missing-both
  gating, search-provider selection/no alternate, idempotency, source failures,
  and missing effort/value semantics.
