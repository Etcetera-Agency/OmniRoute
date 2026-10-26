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
       -> persist source receipt + exact raw matches
       -> if any required source failed or was truncated: pending_unrated
       -> else if AA or official exact match exists: existing_benchmark_record
       -> else query HF eval metadata and explicit ollama-search
       -> persist raw HF and search results
       -> if search results and live free/strict-SO gates pass: one pinned model call
       -> validate exact identity, returned URL, and literal source quote
       -> persist accepted output as candidate-review-required evidence
       -> otherwise leave pending/blocked/unrated
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
1,000 requests/month, and no alternate/retry. A durable model row is attempted at most five times, no more
often than once per 24 hours after an error or no-result run. Each drain handles
all currently eligible rows sequentially and is guarded against concurrent
drains. AA page traversal is capped at five; if the endpoint says more pages
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
  JSON, last error, and normalization block reason.
- `model_benchmark_search_evidence`, one row per deterministic evidence hash.
  It stores source, source version, exact matched identity, benchmark/version,
  nullable effort/config/metric/value, source URL/date, verification status,
  capture time, and source raw JSON.

Evidence uses `INSERT OR IGNORE` by a stable content hash so retries do not
duplicate identical source rows. No evidence table has a score-map write path.
Rollback for an unshipped migration is `DROP TABLE model_benchmark_search_evidence`
then `DROP TABLE model_benchmark_search_models`; normal forward migrations
remain append-only.

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
fallback, and global error fallback. Do not retry. Any missing gate, non-2xx
response, non-`stop` finish, malformed output, unexpected model identity,
unreturned source URL, or quote not literally contained in the corresponding
returned title/snippet leaves the row unrated and records an error/block reason.

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
  while model = claimOldestEligiblePending():
    aa = fetchAllBoundedAAFreePages()
    official = fetchSWEAndTerminalAndDeepSWE()
    persistSourceStatuses(aa, official)
    if any source failed or incomplete:
      markPendingUnrated("source_refresh_incomplete")
      continue
    exact = exactMatches(model, aa, official)
    persistRawMatches(exact)
    if exact is nonempty:
      markExistingRecord()
      continue
    hf = findExactHFModelEvalResults(model, limit=10)
    requireSearchRegistryCost("ollama-search") == 0
    web = explicitSearch(provider="ollama-search", alternateProvider=null, limit=10)
    require(web.provider == "ollama-search" and web.search_cost_usd == 0)
    persistRawEvidence(hf, web)
    if web.results exist and verifyFreePhalaStrictSO():
      output = oneShotPinnedNoFallbackStrictSO(web.results)
      if exactIdentityAndLiteralQuoteMatch(output, web.results):
        persistCandidateReviewRequired(output)
      else:
        persistInvalidOutputUnrated()
    else:
      persistBlockedUnrated()
```

## Operational boundaries

- The read route is authenticated like adjacent settings routes and caps list
  size. It returns no credentials.
- Source data is not automatically refreshed at process startup by this module;
  the existing models.dev sync is the trigger and recovery cadence.
- A controlled live request is still required to establish that the current
  server accepts the exact pinned free connection and returns valid strict-SO
  output. Static source and mocked tests do not prove live provider execution.
