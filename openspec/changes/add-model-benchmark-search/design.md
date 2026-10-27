# Design: Durable missing-model evidence search

## Chosen flow

```text
models.dev fetch succeeds
  -> read prior raw model IDs from model_capabilities
  -> if prior snapshot is non-empty, find new exact IDs
  -> insert each ID once into model_benchmark_search_models
  -> save current models.dev capabilities
  -> start one bounded queue drain (concurrency 1)
       -> load AA Free pages and all configured official leaderboards
       -> claim one row only after an eligible row exists
       -> persist its source receipt + exact raw matches
       -> if any required source failed or was truncated: finish pending_unrated
       -> else if AA or official exact match exists: finish scored/review state
          without HF/web search, even if the direct match has no usable score
       -> else query HF eval metadata and explicit ollama-search
       -> persist raw HF and search results before strict-SO processing
       -> if search results and live free/strict-SO gates pass: one pinned model call
       -> bound that call to five minutes and abort its request on timeout
       -> validate exact identity, returned URL, and literal source quote
       -> persist accepted output as candidate-review-required evidence
       -> finish this row before claiming another
  -> space explicit ollama-search calls at least 15 seconds apart
  -> space actual free-SO requests at least five seconds apart
  -> on search/normalizer HTTP 429, persist reset time and pause the queue
  -> defer exact ollama-search no-credentials errors as cooldowns too
  -> persist the selected normalization connection in the retry receipt
  -> resume the same model through the same provider/model route after reset
  -> if that exact free connection is no longer eligible, block instead of rotating
  -> process at most 20 rows per drain, then continue after 60 seconds
  -> if only fresh `running` rows remain, schedule a retry at their stale boundary
  -> never write ratings or touch the frozen score map
```

The queue insert happens before the capability snapshot is replaced. If the
process stops after enqueue, the next successful periodic sync drains pending
rows. If enqueue fails, the sync attempt fails before it replaces the previous
identity snapshot, so the next sync can detect the same new IDs again. A
first-ever or empty capability snapshot is treated as baseline and queues no
models.

## Source scope and bounds

1. AA Free: `GET https://artificialanalysis.ai/api/v2/language/models/free`
   with `x-api-key` from `AA_API_KEY`, `page=1..N`, default 200
   rows/page. Follow the documented `pagination.has_more`, up to 5 pages. The
   `intelligence_index_version` is the source version. This tier proves only
   AA model presence and its own headline index metadata; it is not a SWE,
   Terminal, or DeepSWE metric. Missing key, HTTP failure, malformed response,
   or more than five pages means AA is unavailable/incomplete and exact
   absence is not established.
2. SWE-bench: fetch the reviewed raw `leaderboards.json` URL and inspect every
   `leaderboards[].results[]` row. The group name and response ETag/Last-Modified
   identify the observed source version.
3. Terminal-Bench 2.0 and 2.1: call the reviewed Supabase read function with
   the fixed package/name pairs already recorded in the frozen evidence. The
   `rows[].metadata` and `rows[].metrics` fields are retained exactly.
4. DeepSWE: fetch the reviewed `leaderboard-live.json` URL and inspect its
   `rows[]`; retain source `generated_at`, benchmark version, raw model,
   `reasoning_effort`, `config`, and metric fields exactly when present.
5. HF: query the Hub models endpoint with one exact models.dev ID (maximum 10
   results), retain only an exact model-ID match, then request that model's
   `evalResults`. The Hub API's `verified`, dataset, value, and source fields
   remain source metadata; they still require review before any rating.
6. Search: after the complete AA+official exact miss only, call the shared
   search execution service with explicit `provider: "ollama-search"` and a
   bounded result count. This resolves the configured Ollama Cloud credential
   and reaches the same `handleSearch` provider executor used by `POST
/v1/search`; the scheduled worker must not pass empty credentials. Do not
   set an alternate provider. Before calling, require registry cost `0`; after
   calling, require response provider `ollama-search` and
   `usage.search_cost_usd === 0`. Pass only its returned
   URLs/titles/snippets to the strict-SO model processor. The model does not run
   its own search. Persist each returned URL/title/snippet as an unverified
   candidate. Search snippets are discovery leads, not scores.

Direct JSON source requests have a 6-second timeout, one retry for transient
network, 429, or 5xx responses, and a 300 ms retry delay. `ollama-search` has a
10-second timeout, zero configured query cost, a current catalog allowance of
1,000 requests/month, and no alternate/retry. A durable model row is attempted
at most five times, no more often than once per 24 hours after an error or
no-result run. Each drain materializes exact AA/leaderboard evidence for at
most 20 eligible rows without claiming them, then recomputes cohort scores. It
claims and finishes rows sequentially, at most 20 per invocation, and is
guarded against concurrent drains. A strict-SO request has a five-minute
deadline; timeout aborts the pinned request and leaves the search evidence
review-required and unrated. When a process starts with only fresh `running`
rows, it schedules one retry for the earliest row's 15-minute stale boundary
instead of depending on the next daily models.dev sync. AA page
traversal is capped at five; if the endpoint says more pages
remain, the receipt is `incomplete`, not `missing`. HF
discovery is capped at ten rows per query and ten exact model details. Search
results are capped at ten. Any hard JSON/shape error records the source error
and leaves the model pending/unrated.

Exact matching trims surrounding whitespace and folds case only. It compares
the source's declared model ID/name fields to the models.dev raw ID and
declared display name. It does not strip providers, tags, effort suffixes,
quantization, dates, punctuation, or aliases. A source result that is merely
similar remains a candidate requiring human review.

## Durable storage

Migration `197_model_benchmark_search.sql` creates:

- `model_benchmark_search_models`, one row per exact raw model ID. It stores
  first/last-seen time, status, attempt count, last attempt time, source status
  JSON, last error, normalization block reason, and nullable rate-limit retry
  time. Migration `199_model_benchmark_search_retry_after.sql` adds the
  `retry_after_at` column to existing queue rows.
- `model_benchmark_search_evidence`, one row per deterministic evidence hash.
  It stores source, source version, exact matched identity, benchmark/version,
  nullable effort/config/metric/value, source URL/date, verification status,
  capture time, and source raw JSON.

Evidence uses `INSERT OR IGNORE` by a stable content hash so retries do not
duplicate identical source rows. No evidence table has a score-map write path.
Migration 199 is additive and needs no data rewrite. Rollback for an unshipped
initial schema is `DROP TABLE model_benchmark_search_evidence` then
`DROP TABLE model_benchmark_search_models`; normal forward migrations remain
append-only.

## Structured-output gate

The extractor is fixed to
`xingchen-agi/xing4.0-29b-a4b:free` through OpenRouter's Phala endpoint. Before
every inference it fetches current endpoint metadata and requires one exact
model endpoint, provider tag `phala`, prompt and completion prices both `0`, and
support for both `response_format` and `structured_outputs`. It then requires
an active OpenRouter API-key connection whose synced model catalog lists that
exact ID with `isFree=true`; select deterministically by sorted connection ID
and pin that ID for the whole request. Clear the session ID and affinity key for
this one-shot dispatch so an older session pin cannot replace the verified
connection.

Build one `json_schema` request with `strict: true`, `provider.only: ["phala"]`,
`provider.require_parameters: true`, and `provider.allow_fallbacks: false`.
Dispatch through an internal one-shot marker that cannot be supplied by a
client. It bypasses combo selection, account retry/rotation, emergency model
fallback, and global error fallback. Space actual normalization requests at
least five seconds apart. Space explicit `ollama-search` queries at least 15
seconds apart. On HTTP 429 from either provider, persist `Retry-After` or
`X-RateLimit-Reset`; if unavailable, defer 15 minutes. Also defer the exact
`No credentials configured for search provider: ollama-search` error for 15
minutes, because live connections may be temporarily rate-limited. Pause the
whole benchmark queue until the retry instant. Retry the same model with
explicit `ollama-search`, then the same exact pinned free connection and
Phala endpoint for normalization. Waiting consumes no attempt. Each real HTTP
429 consumes the existing bounded attempt count; the exact no-credentials
error consumes none because no upstream request occurred. Other non-2xx
responses and invalid output do not retry. Any missing gate, non-`stop` finish,
malformed output, unexpected model identity, unreturned source URL, or quote not
literally contained in the corresponding returned title/snippet leaves the row
unrated and records an error/block reason.

Successful extracted rows retain their raw response and exact quoted evidence
as `candidate_review_required`. They are not a fitness score and have no path
to the frozen benchmark map. The extractor runs only after a complete miss from
AA Free and every required official leaderboard, and only when the shared
search execution returns at least one result from explicit `ollama-search` at
zero cost. Search has no alternate provider.

## Pseudocode

```text
sync(raw):
  prior = readModelCapabilitySnapshot()
  current = exactIdentities(raw)
  if not dryRun and syncCapabilities and prior.hasRows:
    enqueueOnce(current - prior.ids)  // must commit before capability replace
  saveModelsDevPricing(raw)
  saveModelsDevCapabilities(raw)
  if not dryRun:
    scheduleDrainIfIdle()

drainQueue():
  terminalizeMaxAttemptRows()
  if noEligibleRows():
    scheduleRetryAtEarliestRunningRowStaleBoundary()
    return
  snapshot = fetchAllBoundedAAFreeAndOfficialSources()
  candidates = listEligibleRows(limit=20)
  for candidate in candidates:
    direct[candidate.id] = persistExactMatches(candidate, snapshot)
  scores = recomputeCohortFitness()
  completed = 0
  while completed < 20:
    if a persisted normalization cooldown is active:
      scheduleDrainAt(cooldownEnd)
      return
    model = claimOneEligibleRow()
    if no model: break
    if model.id not in direct:
      direct[model.id] = persistExactMatches(model, snapshot)
      scores = recomputeCohortFitness()
    if scores contain coding or general fitness for model:
      finish(model, status="scored")
      completed += 1
      continue
    if any exact AA or official source match exists:
      finish(model, status="review_required", normalizationStatus="not_needed")
      completed += 1
      continue
    hf = findExactHFModelEvalResults(model, limit=10)
    waitUntilFifteenSecondsSincePreviousOllamaSearch()
    web = explicitSearch(provider="ollama-search", alternateProvider=null, limit=10)
    if web.status == HTTP_429 or web.error == EXACT_NO_CREDENTIALS:
      persistRawSearchResultOrError(web)
      persistRetryAfterAt(parseRetryAfterOrRateLimitReset(web) ?? now + 15m)
      if web.error == EXACT_NO_CREDENTIALS:
        releaseClaimWithoutConsumingAttempt()
      // HTTP 429 is a real upstream attempt and remains bounded by MAX_SEARCH_ATTEMPTS.
      pauseWholeQueueUntilRetryAfterAt()
      continue  // do not dispatch strict-SO for this row
    require(web.provider == "ollama-search" and web.search_cost_usd == 0)
    persistRawEvidence(hf, web)  // before strict-SO
    waitUntilFiveSecondsSincePreviousNormalizationRequest()
    output = oneShotPinnedNoFallbackStrictSO(web.results, timeout=5m)
    if output.httpStatus == 429:
      persistRetryAfterAt(parseRetryAfterOrRateLimitReset(output) ?? now + 15m)
      // The pinned strict-SO request is a real provider attempt and remains bounded.
      pauseWholeQueueUntilRetryAfterAt()
      continue
    persistCandidateReviewRequiredOrUnrated(output)
    finish(model)
    completed += 1
  scheduleContinuationOrEarliestCooldownOrStaleRetry()
```

## Operational boundaries

- The read route is authenticated like adjacent settings routes and caps list
  size. It returns no credentials.
- Source data is not automatically refreshed at process startup by this module;
  the existing models.dev sync is the trigger and recovery cadence.
- A controlled live request is still required to establish that the current
  server accepts the exact pinned free connection and returns valid strict-SO
  output. Static source and mocked tests do not prove live provider execution.

## 2026-10-27 defect correction

### Evidence fingerprint

`parseAAEvidence` emits Coding and Intelligence records from the same raw AA
row. Their raw JSON is intentionally identical; their benchmark and metric
identify distinct observations. Add both fields to the existing deterministic
fingerprint before `INSERT OR IGNORE`:

```text
fingerprint(evidence):
  stableContent = existingStableContent(evidence)
  stableContent.benchmark = evidence.benchmark
  stableContent.metric = evidence.metric
  return SHA256(JSON.stringify(stableContent))
```

Do not change any other fingerprint input, source matching, value handling,
normalization, deduplication, fitness formula, thresholds, fallback, or effort
profile. Repeated copies of the same source/benchmark/metric remain one row;
different benchmark or metric records from one raw row remain separate.
Refresh retained raw AA payloads with this same fingerprint to repair legacy
cross-metric collisions. Keep one observation per prior stable identity plus
benchmark/metric; repeated refresh is idempotent.

### Active-catalog discovery gate

Run this only after all direct sources completed and returned exact misses, but
before either HF or Ollama Search:

```text
discover(model):
  activeByProvider = await getAllActiveSyncedModels()
  activeIds = set(
    lowercase(model.id)
    for each catalogModel in flatten(values(activeByProvider))
  )
  if lowercase(model.id) not in activeIds:
    persist sourceStatus.catalogEligibility = {
      status: "unavailable",
      reason: "model_not_in_active_synced_catalog"
    }
    finish model as unrated_no_evidence with no HF, Ollama, or normalizer call
    return
  preserve existing HF -> explicit zero-cost Ollama Search -> strict-SO flow
```

`getAllActiveSyncedModels` already limits the catalog to active provider
connections and excludes search-only providers; lookup errors return an empty
catalog and therefore fail closed. Match model IDs exactly after case folding;
do not match names, prefixes, aliases, or substrings. The guard makes no
provider request, so client search requests and provider attempts remain
separate and unchanged.

### One-shot direct evidence reprocessing

Provide one internal operation that the bundled operator script can call. The
script reads every currently active OmniRoute model ID from active provider
catalogs and passes the complete set; it does not cap the list to a sample or
batch prefix and does not use only models.dev IDs. The operation revalidates
IDs against the active catalogs, so stale or non-ID inputs receive explicit
`missing` receipts and never get materialized. Retained AA raw payloads are
reparsed before the current direct snapshot is materialized, allowing rows no
longer present in the source feed to recover the lost metric too.

```text
reprocessBenchmarkEvidence(requestedIds):
  activeByProvider = await getAllActiveSyncedModels()
  activeModels = flatten(values(activeByProvider))
  matches = exactCaseFoldedIdMatches(requestedIds, activeModels)
  newIds = persist identity-only rows for matched runtime IDs with nonclaimable
    status "unrated_no_evidence"; preserve existing status on conflict
  snapshot = await getBenchmarkSourceSnapshot(fetch)  # one AA + official load
  retainedAa = reparseRetainedAaEvidence(matchedRuntimeIds, snapshot.aa.allRows)
  snapshot.aa.allRows.push(...retainedAa)
  receipts = []
  for each requestedId:
    if no active ID match:
      receipts.push({
        modelId: requestedId,
        identityStatus: "missing",
        evidenceStatus: "missing",
        sources: each source's status/completeness, identityMatch: "missing",
          and records: 0
      })
      continue
    model = matched active catalog record
    direct = materializeModelEvidence(model, snapshot)  # no queue/refresh path
    receipts.push({
      modelId: model.id,
      identityStatus: "matched",
      evidenceStatus: "matched" if any direct check has records, else "missing",
      sources: each direct check's status, completeness, record count, and
        identityMatch (matched, ambiguous, missing, or unverified),
      evidenceWrites: direct evidence writes, including repaired AA rows
    })
  fitness = await recomputeModelBenchmarkFitness()  # one global/profile pass
  for each id in newIds:
    status = scored if global fitness has coding/general score for id
      else review_required if its receipt has direct matches
      else unrated_no_evidence
    persist status  # all outcomes remain nonclaimable
  return { receipts, fitness observationCount, total/profile publication counts }
```

The identity contract follows the existing band consumer. `getAllActiveSyncedModels`
returns each provider catalog row's raw `model.id`; `virtualFactory` carries that
value as `candidate.model` for quality-band lookup and keeps
`${providerId}/${modelId}` separately as `candidate.modelStr` for routing. The
operator SHALL persist and publish fitness under the raw `model.id`, without
adding or removing a provider segment. The free band filter resolves
`benchmark_fitness:{low|medium|high}` for that raw ID before its static
`benchmark_consensus` and `models_dev_tier` fallbacks. Verify the path with the
real free-band consumer for `coding_high_tools:free` and
`general_high_tools:free`; assert the route-facing provider/model string stays
separate from the fitness key. Do not change formula, precedence, or ranges.

The operation may persist identity-only rows for validated active runtime IDs
to satisfy the evidence table's foreign key. New identity rows SHALL start
nonclaimable as `unrated_no_evidence`; an existing status SHALL be preserved on
conflict. After recomputation, only newly inserted rows SHALL settle to
`scored`, `review_required`, or `unrated_no_evidence` from their direct evidence
and computed score; these outcomes remain nonclaimable. The operation SHALL not create search run/job rows, claim queued
work, or call queue drain, `refreshSearchRun`, Hugging Face, Ollama Search, or
strict-SO. Evidence SHALL retain the actual runtime ID;
source matching SHALL use exact raw source IDs or unique exact names only,
without provider-prefix stripping. Direct source incompleteness stays visible
in each receipt; it does not become a negative match. Global recomputation is
deliberate: existing base and effort profile entries must all reflect the
repaired evidence. The script prints the returned JSON receipt and exits
nonzero if source loading or fitness recomputation cannot complete.

Bundle the script entry with esbuild during the backend-builder stage, bundle
local application code, leave runtime packages external, and copy the output
into the final official-image overlay. Keep the upstream standalone entrypoint
and command unchanged. Run the bundle only through an explicit `node` operator
command with `/app/data` as `DATA_DIR`; never attach it to service startup. The
release runbook must pause startup-triggered models.dev sync/queue drain before
the maintenance restart, then execute the one-shot bundle once.
