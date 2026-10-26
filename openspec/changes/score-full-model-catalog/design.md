# Design: Full-catalog benchmark fitness

## Chosen scoring rule

The score is model-level and task-level; it does not require a particular
reasoning effort or capability. Every eligible observation with an exact model
identity is retained. If a benchmark reports multiple reasoning efforts or
configurations, score each reported cohort separately and take the median of
the resulting normalized observations. An absent effort/configuration is its
own null cohort; it contributes no zero.

1. Accept numeric observations only from the existing AA Free response, the
   pinned official SWE-bench / Terminal-Bench 2.0 and 2.1 / DeepSWE sources,
   HF `evalResults` explicitly marked verified, or the existing strict-SO
   search processor after its exact identity, returned URL, and literal quote
   checks succeed. Candidate search rows that fail any gate remain raw and do
   not count.
2. Keep only the recognized `AA Coding`, `AA Intelligence`, `SWE-bench`,
   `Terminal-Bench`, and `DeepSWE` families and their supported positive
   quality metrics. Deduplicate identical model/family/version/effort/config/
   metric/value records before scoring.
3. For each benchmark/version/effort/config cohort, rank exact models by the
   reported higher-is-better metric. Convert each value to its midrank
   percentile `(count_less + 0.5 * count_equal) / count_total`. A cohort with
   fewer than two distinct models supplies no percentile; it never awards an
   automatic `0.5`.
4. A model's family vote is the median of its available cohort percentiles in
   that family. Coding fitness is the median of the AA Coding vote plus at most
   one vote for each of SWE-bench, Terminal-Bench, and DeepSWE. Without AA
   Coding, at least two independent benchmark families are required for coding
   fitness.
5. General fitness is the AA Intelligence vote when available. If one task has
   no score but the other does, copy the measured score to the missing task and
   record the fallback in confidence metadata. Missing values are never zero.
6. Preserve score provenance and coverage counts in the durable run/evidence
   records. Save numeric ratings in `model_intelligence` with source
   `benchmark_fitness`; resolution order is `user_override`, `arena_elo`,
   `benchmark_fitness`, then existing capability/static fallbacks.

This is a relative score over current comparable catalog observations. As new
exact evidence arrives, scores are recomputed from the stored cohort and may
move. Search-based observations remain identifiable in provenance and are
never treated as official-leaderboard records.

## Catalog ingestion and durable continuation

Add a catalog state marker and a transactional enqueue operation. On a
successful, non-dry-run models.dev sync:

- If no full-backfill marker exists, enqueue all deduplicated model IDs from
  the fetched catalog and set the marker in the same SQLite transaction.
- Otherwise enqueue IDs absent from the previous capability identity
  snapshot. If the snapshot is empty, enqueue the current full catalog.
- Do not update the marker or replace the prior capability snapshot if queue
  insertion fails.
- The queue's model ID primary key makes repeated syncs idempotent.

Drain at most 20 models per invocation. Store raw sources and score state
before yielding. If eligible rows remain, schedule the next bounded drain one
minute later. The existing database claim protects rows across restarts and
multiple processes. Each invocation reuses one immutable AA/official source
snapshot for up to 24 hours, avoiding a full five-source download for every
catalog model. Per-model HF and free search calls occur only if direct evidence
does not support a numeric task score.

When queue work changes evidence, recompute the `benchmark_fitness` rows from
all stored eligible evidence, then invalidate the in-process fitness cache.
Never delete manual or Arena rows. A model with no eligible evidence has no
`benchmark_fitness` score and remains explicitly unrated.

## Source handling

- AA keeps its existing Free API endpoint and page ceiling. Parse exact slug or
  exact model-name matches. Read `artificial_analysis_coding_index` and
  `artificial_analysis_intelligence_index` from `evaluations`; null/missing
  remains missing.
- Keep the existing official benchmark URLs, version labels, and exact model
  matching. Download each dataset once per source snapshot, then match the
  model locally.
- HF contributes only exact model-ID `evalResults` rows with `verified: true`
  and a recognized family/metric.
- Web extraction remains the current fixed `xingchen-agi/xing4.0-29b-a4b:free`
  Strict-SO call through the verified Phala endpoint. It contributes only
  exact model results whose source URL was returned by `/v1/search` and whose
  quote literally contains the populated identity, benchmark, metric, value,
  effort/config, and date fields. No paid or alternate provider is allowed.
- Unknown families, ambiguous IDs, unsupported metric directions, and absent
  values are retained as diagnostics but do not vote.

## Pseudocode

```text
syncModelsDev(raw):
  current = exactUniqueModelIds(raw)
  transaction:
    if fullCatalogBackfillMarker is absent:
      enqueue(current)
      set marker
    else:
      enqueue(current - previousCapabilityIds)
  save pricing/capabilities
  schedule drain if idle

drainBatch():
  snapshot = cachedOrFetchOnce(AA_Free, SWE, Terminal_2_0,
                               Terminal_2_1, DeepSWE; ttl=24h)
  repeat at most 20 times:
    model = atomically claim oldest eligible queue row
    if none: stop
    direct = exactMatches(model, snapshot)
    save direct evidence and source receipts
    if direct evidence cannot produce either task score:
      save exact HF verified eval rows
      search only with explicit duckduckgo-free
      strictSO = process returned search rows using fixed free Phala model
      save candidates; only exact URL/quote-validated rows become eligible
    recompute all model scores from eligible stored evidence
    save/refresh only benchmark_fitness rows; preserve user_override and arena_elo
    finish model as scored, review_required, unrated_no_evidence, or source_error
  invalidate fitness cache if scores changed
  if eligible rows remain: schedule drainBatch in 60 seconds

scoreCatalog(evidence):
  discard wrong model, unsupported family/metric, nonnumeric or unverified rows
  group observations by family/version/effort/config
  dedupe identical observations
  for each group with >=2 exact models: map values to midrank percentiles
  familyVote(model, family) = median(available observation percentiles)
  coding = median(AA Coding + one vote per SWE/Terminal/DeepSWE family)
  require AA Coding or at least two benchmark families for coding
  general = AA Intelligence
  if one task is missing and the other is present: copy the present task
  if both are missing: leave the model unrated
```

## Failure and recovery

Source errors stay attached to the model row and are retryable under the
existing attempt policy. A failed source is not proof of absence. Queue
insertion, marker update, and snapshot replacement are ordered so a failed
backfill cannot lose unseen IDs. A process restart resumes from durable queue
state. Incomplete or unverified evidence cannot create a numeric score.
