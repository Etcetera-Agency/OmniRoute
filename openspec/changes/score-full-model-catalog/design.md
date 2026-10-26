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
   Coding, one verified benchmark-family vote is enough for a provisional
   coding fitness when its cohort has at least two exact models. Mark that
   model's confidence low; singleton cohorts still produce no percentile.
5. General fitness is the AA Intelligence vote when available. If one task has
   no score but the other does, copy the measured score to the missing task and
   record the fallback in confidence metadata. Missing values are never zero.
6. Preserve score provenance and coverage counts in the durable run/evidence
   records. Save numeric ratings in `model_intelligence` with source
   `benchmark_fitness`; resolution order is `user_override`, `arena_elo`,
   `benchmark_fitness`, then existing capability/static fallbacks. A single
   benchmark-family vote without AA Coding remains numeric but is published
   with low confidence.

This is a relative score over current comparable catalog observations. As new
exact evidence arrives, scores are recomputed from the stored cohort and may
move. Search-based observations remain identifiable in provenance and are
never treated as official-leaderboard records.

## Band effort profiles

Keep the current global score as the unprofiled fallback used by generic Auto
task scoring. Also compute three independent scores for band filtering:

- `low` uses a model's `low` observations.
- `medium` uses a model's `medium` observations.
- `high` prefers a model's `xhigh` observations, then its `high` observations.

For each profile, form comparable populations by family, benchmark, version,
configuration, and metric. For each model in a population, first select the
profile's effort. When that effort is missing, use the model's unknown-effort
observations; if those are absent, use the median of that model's available
effort observations in the same population as a proxy. Rank one selected
model value per population using the same midrank rule. Any unknown or
cross-profile proxy marks the affected profile result low confidence. This
allows a model without reasoning metadata to retain evidence without treating
missing effort as zero or filtering by reasoning capability.

Combine profile percentiles with the same one-vote-per-family median and
reciprocal coding/general fallback as global scores. One verified benchmark
family can provisionally support coding when its peer population contains at
least two exact models; mark it low confidence. A population with only one
exact model supplies no percentile. If a profile has no usable score, persist
no row and allow existing score sources to resolve it.

Persist profile scores as `benchmark_fitness:low`, `benchmark_fitness:medium`,
and `benchmark_fitness:high`; preserve the global `benchmark_fitness` rows for
unprofiled Auto scoring. For a band request, resolve direct and inherited
`user_override` and `arena_elo` first, then the matching profile score, then
the existing global and static fallbacks. Profile scores must not be masked by
an inherited global row. Recompute profile rows as a replacement set so stale
scores disappear when evidence no longer supports them. Keep all profile
benchmark rows subject to the existing free-band source gate.

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
  if coding has one benchmark family and no AA Coding: confidence = low
  require at least two peer models in each cohort; never invent singleton .5
  general = AA Intelligence
  if one task is missing and the other is present: copy the present task
  if both are missing: leave the model unrated

scoreBandProfiles(evidence):
  for profile in [low, medium, high]:
    group by family/benchmark/version/config/metric, without effort in key
    per model and group:
      low: select low; medium: select medium
      high: select xhigh if present, else high
      if desired effort missing: select unknown effort if present
      else select that model's median across available efforts; mark proxy
      if fewer than two distinct exact models: emit no percentile
      else rank one selected model value by midrank
      if unknown or other-effort proxy was selected: profile confidence = low
    reduce profile percentiles to one median vote per family
    coding = median(AA Coding + at most one vote per benchmark family)
    if no AA Coding and one benchmark family: allow provisional low confidence
    general = AA Intelligence
    if exactly one task is missing: copy the other with low confidence
    persist only non-null task scores under benchmark_fitness:<profile>
  atomically replace profile-source rows so obsolete scores are removed
  for generic Auto scoring, keep scoreCatalog's existing global rows
```

## Failure and recovery

Source errors stay attached to the model row and are retryable under the
existing attempt policy. If the only recorded blocker is that `AA_API_KEY` was
not configured, a later drain with the key configured may retry that row
immediately, including rows whose ordinary retry count was exhausted. This
retry is still bounded by one claim at a time and must re-run the complete
source snapshot; a failed or incomplete AA scan never becomes an exact miss.
Other source errors keep their normal retry delay. Queue insertion, marker
update, and snapshot replacement are ordered so a failed backfill cannot lose
unseen IDs. A process restart resumes from durable queue state. Incomplete or
unverified evidence cannot create a numeric score.
