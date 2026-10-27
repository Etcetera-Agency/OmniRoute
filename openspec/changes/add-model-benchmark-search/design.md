# Design: Durable missing-model evidence search

## Chosen flow

```text
normal models.dev sync fetch succeeds
  -> preserve existing pricing and capability writes
  -> pass the same fresh, full canonical identity set to the background refresh
  -> skip refresh for dry-run or capability-disabled sync
  -> serialize refresh calls in invocation order; retain every call's payload
  -> fetch AA Free and all four official sources
  -> if any source is missing, malformed, incomplete, or empty: write nothing
  -> otherwise match exact IDs, then unique exact canonical names
  -> in one DB transaction, replace five direct current sets and publish four
     owned native fitness sources for every canonical raw ID
  -> clear every evidence scope and owned native key for IDs removed from catalog
  -> isolate refresh errors from successful pricing/capability sync

manual benchmark discovery queue
  -> remains separate from normal models.dev sync
  -> claim and finish one eligible row at a time; retain existing retry rules
  -> replace only validated exact model/source current observations
  -> keep unverified search output review-only and outside formula/native scores
```

Normal sync does not enqueue models or drain the optional discovery queue. A
source or publication failure in the background refresh leaves the last valid
benchmark snapshot intact; it does not undo completed pricing or capability
writes. The explicit maintenance operator uses the same full-catalog refresh
for the persisted canonical catalog.

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
  and capture time. This was the legacy schema; migration 200 removes its
  `raw_json` column and compacts duplicate formula observations.

Migration 200 renames the evidence table to `model_benchmark_evidence`, removes
the raw payload column, and retains only the latest row for each exact existing
formula-observation key. New source updates replace exact current sets; they do
not build a raw-payload archive. Migration 199 is additive. Normal forward
migrations remain append-only.

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

Validated extracted observations retain only current normalized fields and
source references as `candidate_review_required`; raw provider responses are
not stored. They are not formula inputs and have no direct path to native
fitness. The extractor runs only after a complete miss from AA Free and every
required official leaderboard, and only when shared search returns at least
one result from explicit `ollama-search` at zero cost. Search has no alternate
provider.

## Pseudocode

```text
sync(raw):
  saveModelsDevPricing(raw)
  saveModelsDevCapabilities(raw)
  if not dryRun and syncCapabilities:
    startBackgroundCurrentRefresh(exactIdentities(raw))
  // never enqueue identities or start a queue drain here

refreshCurrent(catalog):
  enqueue in-process promise tail       // preserve invocation order and payloads
  load and validate all five complete, nonempty sources before writes
  on invalid input: return incomplete; leave prior evidence and scores intact
  transaction:
    replace all five direct current source sets
    clear every benchmark evidence scope for IDs absent from catalog
    compact duplicate legacy formula keys; drop legacy raw payloads
    recompute unchanged base and profile formulas for every catalog raw ID
    replace all four owned native fitness sources together
  invalidate fitness cache after commit
  isolate errors from the successful pricing/capability sync

drainQueue():
  // separate optional discovery flow; normal sync does not call this
  terminalizeMaxAttemptRows()
  if noEligibleRows():
    scheduleRetryAtEarliestRunningRowStaleBoundary()
    return
  snapshot = fetchAllBoundedAAFreeAndOfficialSources()
  candidates = listEligibleRows(limit=20)
  for candidate in candidates:
    direct[candidate.id] = replaceValidatedCurrentSourceSets(candidate, snapshot)
  scores = recomputeUnchangedFitnessFromCurrentEvidence()
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
      persistSearchStatusOnly(web)
      persistRetryAfterAt(parseRetryAfterOrRateLimitReset(web) ?? now + 15m)
      if web.error == EXACT_NO_CREDENTIALS:
        releaseClaimWithoutConsumingAttempt()
      // HTTP 429 is a real upstream attempt and remains bounded by MAX_SEARCH_ATTEMPTS.
      pauseWholeQueueUntilRetryAfterAt()
      continue  // do not dispatch strict-SO for this row
    require(web.provider == "ollama-search" and web.search_cost_usd == 0)
    replaceValidatedHFCurrentSet(hf)  // valid empty response clears the set
    persistReviewSourceReferences(web) // no raw search payload
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
- Normal models.dev sync starts the full-catalog refresh after its existing
  pricing/capability writes, using the fresh catalog. It never enqueues
  identities or drains the separate discovery queue.
- A controlled live request is still required to establish that the current
  server accepts the exact pinned free connection and returns valid strict-SO
  output. Static source and mocked tests do not prove live provider execution.

## 2026-10-27 defect correction

### Evidence fingerprint

`parseAAEvidence` emits Coding and Intelligence records from the same AA row.
Their benchmark and metric identify distinct formula observations. Include both
fields in the deterministic fingerprint so the two records cannot collide:

```text
fingerprint(evidence):
  stableContent = existingStableContent(evidence)
  stableContent.benchmark = evidence.benchmark
  stableContent.metric = evidence.metric
  return SHA256(JSON.stringify(stableContent))
```

Do not change other source matching, value handling, normalization,
deduplication, fitness formula, thresholds, fallback, or effort profile.
Repeated copies of the same source/benchmark/metric remain one observation;
different benchmark or metric records remain separate. Migration 200 uses the
same benchmark/metric distinction in its formula-observation key before
dropping all legacy raw payloads.

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

### Current benchmark snapshot and native publication

Replace the former active-provider-only direct reprocessor with an explicit
full-catalog current-data refresh. Enumerate distinct IDs from the local
`model_capabilities` table, populated from the full canonical models.dev
catalog. Use exact canonical names where available. Do not derive this catalog
from active provider connections, search queue membership, or a fixed result
limit. Direct benchmark sources may match inactive canonical models. Search
discovery eligibility remains independently limited to active synced provider
catalogs.

Load AA with full pagination and the four existing official feeds once. Require
all five results to be complete and nonempty before any evidence or fitness
write. Match exact raw source IDs first; otherwise accept one exact name among
canonical identities. Preserve ambiguity as unmatched. Do not strip provider
prefixes, normalize names, use aliases, or use fuzzy/substring matches.

The stored unit is the current observation set for one source/model. A complete
successful refresh replaces that set, deleting prior values or observations no
longer present. Row identity follows the existing formula observation key;
distinct benchmark, harness/version, metric, effort, and configuration
observations remain separate. Changed source versions/values replace old rows;
they do not append history. Store formula inputs and current source references
needed by existing readers, not raw source payloads or a version archive.

Migration 200 renames `model_benchmark_search_evidence` to
`model_benchmark_evidence`, preserves relational constraints, compacts
duplicate rows by the exact existing formula-observation key, and drops
`raw_json` for every source. For each key it retains the latest `captured_at`
row; ties use the existing reader's ordering. Distinct keys remain. Migration
does not publish scores. Legacy rows lack a complete-source boundary, so
deleted keys and successful empty source results cannot be reconstructed. For
IDs still in the catalog, distinct non-direct observations remain last-known
current data until valid replacement. A complete refresh clears all benchmark
evidence scopes for IDs absent from the fresh canonical catalog.

Replace exactly `benchmark_fitness`, `benchmark_fitness:low`,
`benchmark_fitness:medium`, and `benchmark_fitness:high` through the native
storage helper in one database transaction. This removes stale keys from these
owned sources while preserving `user_override`, arena values, and unrelated
sources. Publish raw canonical IDs. Keep formula, family mapping, observation
deduplication, reciprocal fallback, thresholds, and profile rules unchanged.
The existing AutoCombo consumer continues to resolve these keys; regression
tests use that actual consumer and prove `candidate.model` is the raw ID while
`candidate.modelStr` remains provider-prefixed. Do not edit filters, routes,
capability metadata, or score defaults.

Successful HF and queued benchmark updates use the same current-set contract
for their exact model/source scopes. A valid empty result clears the prior set.
A successful queued normalization replaces its normalized-source set only
after validation succeeds. Errors, timeouts, invalid payloads, and incomplete
reads preserve the last valid set. Keep queue receipts and active-catalog
discovery behavior separate from full-catalog scoring.

```text
refreshCurrentBenchmarkFitness(canonicalCatalog):
  canonical = distinct raw IDs and exact names from canonicalCatalog
  snapshot = load(AA full pages, SWE-bench, Terminal-Bench 2.0, 2.1, DeepSWE)
  if any source is error, incomplete, missing, malformed, or empty:
    return incomplete receipt; do not write evidence or scores

  rows = for each source observation:
    match exact raw ID, else unique exact name in canonical catalog
    preserve all distinct formula observations; skip missing/ambiguous matches

  in one database transaction:
    replace current sets for all five direct sources
    clear every evidence scope for IDs absent from canonical
    observations = existing current evidence adapter
    base = unchanged formula(observations, every canonical raw ID)
    profiles = unchanged formula(observations, every canonical raw ID, each profile)
    replace base and three profile sources together

  invalidate fitness cache after commit
  return source, observation, and publication counts
```

The explicit bundled entry stays in the final-image runtime path and retains its
side-effect-free `--check-runtime` smoke. Normal models.dev sync invokes the
background full-catalog refresh after its existing writes; the explicit
operator remains available for controlled maintenance. Neither path enqueues
or drains discovery work. Do not run live source discovery, search, or inference
during this local package.

## 2026-10-27 final-image operator package check

The direct operator's dependency graph must be tested after esbuild output is
copied into the final image stage. A successful bundle build or syntax check
does not prove that runtime-external packages exist in the image. Run a
side-effect-free module-load check in the final stage; it must stop before
catalog access, AA/official source requests, database writes, queue activity,
search-provider calls, or inference. A missing runtime import fails image
packaging before deployment.

```text
verifyOperatorRuntime(bundle):
  load(bundle.runtimeModuleGraph)
  return before catalog reads, source requests, database writes, queue work,
    search-provider calls, or inference

buildFinalImage():
  copy(bundle, finalImage.operatorPath)
  verifyOperatorRuntime(finalImage.operatorPath)
  fail packaging when module loading fails
```
