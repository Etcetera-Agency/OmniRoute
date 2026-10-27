# Change: Search benchmark evidence for newly synced models

## Why

The runtime reads benchmark fitness from native `model_intelligence` sources.
The earlier queue flow did not refresh and publish one authoritative snapshot
for the full models.dev catalog. New or inactive canonical models could remain
unrated, while historical evidence rows could outlive the source values that
produced them.

The current refresh must validate the complete existing benchmark source set,
replace current formula inputs, and publish unchanged fitness calculations
under every canonical raw model ID. Optional benchmark discovery stays on its
separate manual queue path and cannot be triggered by normal models.dev sync.

## What changes

- After normal models.dev pricing and capability writes succeed, start a
  background full-catalog refresh from that same freshly fetched canonical
  identity set. Dry runs and capability-disabled syncs do not start it. Refresh
  requests serialize in call order; each request keeps its own catalog.
- Require complete, valid, nonempty AA plus all four existing official feeds
  before evidence or native score writes. Match exact raw IDs first, then one
  exact canonical name; leave ambiguous names unmatched.
- Replace current source/model observations and all four owned native fitness
  sources atomically. Successful refresh removes omitted observations and
  deleted-catalog evidence; failed refresh preserves the last valid snapshot.
- Store only current formula inputs and source references. Do not store raw
  payloads or changed-value history. Compact legacy duplicate formula
  observations using the existing observation key and capture ordering.
- Keep the existing optional discovery queue and its review workflow separate
  from normal catalog sync. Successful HF or queued source updates replace
  their exact current source/model set; valid empty results clear that set and
  failed or malformed results preserve it.
- Refresh the bounded source set: AA Free language-model pages; the existing
  official SWE-bench, Terminal-Bench 2.0, Terminal-Bench 2.1, and DeepSWE
  endpoints; Hugging Face Hub model eval metadata; and `/v1/search` with the
  explicitly selected, configured zero-cost `ollama-search` provider and no
  alternate. Resolve its Ollama Cloud credential through the existing search
  execution service; never pass empty credentials to the provider handler.
- Keep manual HF and Ollama Web Search discovery behind the existing complete
  exact-match miss, active-catalog, zero-cost, and review gates. Unverified
  search candidates do not affect formula inputs or native fitness.
- Fail closed unless the provider registry reports zero query cost and the
  result reports provider `ollama-search` with `search_cost_usd=0`. Its current
  catalog quota is 1,000 requests/month; no paid provider may be selected as
  fallback.
- Keep missing or unverified discovery evidence pending/unrated. Missing effort
  stays null. Store only fields required by the formula and current source
  references; do not store raw payloads.
- Keep the authenticated read endpoint limited to existing current evidence
  and queue status records.

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

The one-shot dispatch bypasses combo routing, account rotation, and
global/emergency fallback. It does not retry an individual model request.
HTTP 429 is durably deferred by the queue: honor `Retry-After` or
`X-RateLimit-Reset`, otherwise wait 15 minutes; pause all free-SO calls until
then and retry only the same model through the same pinned free connection.
The wait itself consumes no attempt. A real HTTP 429 consumes the existing
bounded attempt count, so repeated provider failures stop after the normal
maximum. The exact no-credentials failure occurs before an upstream request
and consumes no attempt. If any other live metadata, local connection,
internal key, request, or response validation gate fails, record the
blocked/error state and leave the model unrated. Accept output only when its
model identity, source URL, quoted source text, benchmark fields, and values
match the returned search material.
Accepted output remains candidate-review-required; it never updates the frozen
score map. Do not use another model, provider, JSON mode, or paid/out-of-band
route as fallback.

## Non-goals

- No formula, normalization, deduplication, fallback, effort-profile,
  threshold, or score-consumer changes. Only complete validated benchmark
  inputs may update native fitness.
- No change to auto bands, free-tier routing, feature flags, provider settings,
  periodic-sync cadence, or live service configuration.
- No paid inference, provider auto-selection, fallback bands, zero-fill, fuzzy
  identity aliases, or score inference from search snippets. Free strict-SO
  extraction only creates review-required evidence and cannot publish ratings.

## 2026-10-27 defect correction

Two defects were confirmed in the existing source-lookup slice:

- The stable evidence fingerprint does not include benchmark/metric identity.
  AA Coding and AA Intelligence are parsed from one source row with identical
  raw payload, so `INSERT OR IGNORE` can discard the second metric. Include
  `benchmark` and `metric` in the fingerprint; keep all other source matching,
  normalization, and deduplication rules unchanged.
- A complete miss in AA and the official sources currently starts HF and
  Ollama Search even when the model ID is absent from OmniRoute's active synced
  provider catalogs. Before either discovery request, require an exact
  case-folded model-ID match from `getAllActiveSyncedModels`. Persist an
  unavailable-catalog reason and leave the model unrated when no match exists.

Do not change the fitness formula, thresholds, fallback, effort profiles, or
provider attempt accounting. Preserve the existing Hugging Face query/detail
route for eligible catalog models.

The prior active-provider-only direct reprocessor does not satisfy the current
fitness refresh. Replace it with one explicit full-catalog refresh over every
distinct canonical ID in the local `model_capabilities` catalog. Keep the
existing active-catalog gate for search discovery; this direct refresh may
materialize available source rows for inactive canonical models and never
starts search or inference.

Load AA with full pagination plus the existing SWE-bench, Terminal-Bench 2.0,
Terminal-Bench 2.1, and DeepSWE sources. Require every source to be complete
and nonempty before writes. Match exact raw IDs first, then one exact name in
the canonical catalog. Leave duplicate names unmatched. Preserve all current
distinct benchmark, harness/version, metric, effort, and configuration
observations; replace changed or removed values rather than appending history.

Rename `model_benchmark_search_evidence` to `model_benchmark_evidence` in
migration 200. Preserve and compact existing formula observations in the
migration; do not infer complete source snapshots or publish scores from
legacy rows. Keep the latest row for each exact existing formula-observation
key by `captured_at`, using the existing reader's tie ordering, and clear every
legacy raw payload. The first valid full refresh atomically replaces the five
direct-source sets, clears every benchmark evidence scope for IDs absent from
the fresh canonical catalog, recomputes the unchanged formula for every
canonical ID, and replaces the owned native base/profile score sources. New
evidence stores formula inputs and current source references only. Successful
HF and queued source updates replace their model/source set; errors preserve
the last valid set, and valid empty results clear it.

Publish the existing `model_intelligence` sources
`benchmark_fitness`, `benchmark_fitness:low`, `benchmark_fitness:medium`, and
`benchmark_fitness:high` under raw canonical IDs. Replace those four sources
together so stale owned keys disappear while overrides, arena scores, and
unrelated sources remain intact. Keep the formula, matching normalization,
deduplication, fallback, thresholds, and profiles unchanged. Do not edit
capability metadata, AutoCombo filters, routing, or defaults.

### Current refresh pseudocode

```text
refreshCurrentBenchmarkFitness(freshCatalog):
  canonical = all distinct IDs and known names from freshCatalog
  snapshot = load AA full pagination + SWE-bench + Terminal-Bench 2.0/2.1 + DeepSWE
  if any source is error, incomplete, missing, malformed, or empty:
    return incomplete receipt with no evidence or score writes

  rows = materialize each source against canonical:
    exact raw ID first; otherwise unique exact name in canonical catalog
    preserve all distinct current formula observations
    leave missing or ambiguous names unmatched

  transaction:
    replace all five direct source/model sets with rows
    clear all benchmark evidence scopes for IDs absent from canonical
    compact duplicate legacy rows by the exact formula-observation key
    clear all legacy raw payloads
    observations = existing formula input adapter over current evidence
    scores = unchanged base and low/medium/high formula for every canonical ID
    replace all four owned native score sources together

  invalidate existing fitness cache after commit
  return source, observation, and publication counts
```

Migration 200 keeps the latest `captured_at` row for each exact existing
formula-observation key; equal timestamps follow the existing reader's ordering.
It preserves distinct keys. Legacy rows have no complete-source boundary, so
deleted keys and successful empty source results cannot be reconstructed. For
IDs still in the catalog, distinct legacy HF and other non-direct observations
remain last-known current data until a valid source-set replacement. A
successful full refresh clears all evidence scopes for IDs removed from the
canonical catalog. The background models.dev hook and explicit operator use
this full-catalog operation; it does not enqueue or drain the optional
discovery queue. Keep the side-effect-free final-image `--check-runtime` smoke.
Do not run source discovery, search, or inference in this local package.

## Acceptance

- A normal successful models.dev sync invokes the full-catalog refresh with
  fresh raw identities after its existing pricing/capability writes; it does
  not enqueue or drain the optional discovery queue.
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
- Current evidence includes exact model identity and required formula/source
  references; reasoning effort/config stays null when the source omits it, and
  raw payloads are not stored.
- Pending, errored, and review-required discovery records cannot alter native
  fitness sources or unrelated `model_intelligence` sources.
- Focused RED/GREEN tests cover sync-trigger conditions, exact missing-both
  gating, search-provider selection/no alternate, idempotency, source failures,
  and missing effort/value semantics.
- Current-snapshot regressions prove full canonical coverage, exact raw/routed
  identity separation, replacement of changed/deleted rows, preservation of
  distinct current effort/harness rows, unchanged scores after incomplete
  inputs, no evidence-history growth, and lookup by the unchanged actual band
  consumer.
- Normal-sync hook regressions prove pricing/capability writes still run,
  refresh receives the fresh catalog, source failures stay isolated, concurrent
  refresh calls serialize without losing later payloads, and the search queue
  is not enqueued or drained by that hook.

## 2026-10-27 direct operator runtime packaging correction

The PR #39 operator bundle was deployed in the ARM64 image
`ghcr.io/etcetera-agency/omniroute@sha256:c51c4d12acaaf038eb7634eef62d50ce1b660f3c5b828be35e167550eb7cacd9`,
but an explicit invocation failed before database work with
`ERR_MODULE_NOT_FOUND: @aws-sdk/client-bedrock-runtime`. Bundle size and syntax
checks did not exercise module resolution against the final image's runtime
dependencies. Add a build-time smoke that loads the copied operator's complete
runtime module graph in that dependency tree and stops before catalog reads,
source requests, database writes, queue work, search, or inference. An
unresolved runtime module SHALL fail image packaging. Normal models.dev sync
and the explicit operator use the same current-catalog operation; the smoke
itself triggers neither.
