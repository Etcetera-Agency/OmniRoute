# Change: Score the full models.dev model catalog

## Why

The benchmark search currently starts only for model IDs that are new after a
non-empty models.dev snapshot. Existing models never enter the queue, and the
search stores evidence without turning it into a score. The deployed catalog
therefore cannot build or maintain the requested coding/general model scores.

## What changes

- Enqueue every unique exact models.dev model ID once for a resumable initial
  backfill, and enqueue newly observed IDs on later successful syncs.
- Reuse bounded source snapshots across catalog batches, then collect exact
  Artificial Analysis, official benchmark, Hugging Face, and strict-SO search
  evidence when a model needs more evidence.
- Normalize comparable observations by midrank inside the same benchmark,
  version, reasoning-effort, and configuration cohort. Combine multiple
  efforts without converting missing effort data into zero.
- Keep global scores for generic Auto routing and also calculate low, medium,
  and high profile scores for band selection. High prefers each model's xhigh
  observations, then high. Missing profile effort uses unknown-effort evidence,
  then a marked low-confidence proxy from that model's other efforts; it never
  becomes zero and never gates on reasoning capability.
- Publish supported model-level `coding` and `general` scores using the agreed
  per-family median and reciprocal task fallback. Store global scores under
  `benchmark_fitness` and band scores under `benchmark_fitness:<profile>` so
  manual and Arena scores retain priority.
- Keep models without enough eligible evidence unrated. Never synthesize a
  score for a model with no comparable measurements.
- Limit each queue drain to a bounded batch and resume it in the background;
  persist progress so a restart continues from the queue.

## Non-goals

- No paid inference, alternate search provider, or paid Artificial Analysis
  endpoint.
- No changes to model capabilities, free-tier pricing, provider settings, or
  manual/Arena ratings.
- No score derived from an unverified search result, an unknown benchmark
  family, or a missing metric.
- No change to the existing score bands or reasoning capability filters.

## Acceptance

- A successful sync against an already-populated catalog durably queues every
  unique model ID once; later syncs queue only newly observed IDs.
- A bounded drain processes only its configured batch, persists source and
  score state, invalidates fitness caches, and schedules continuation while
  work remains. A restart does not lose queued models.
- Exact eligible evidence produces deterministic scores for `coding` and/or
  `general`; repeated identical evidence does not change the result.
- Per-family aggregation counts AA Coding, SWE-bench, Terminal-Bench, and
  DeepSWE at most once each. Missing effort values are omitted, not zero-filled.
- Low, medium, and high bands resolve their own profile scores; high prefers
  xhigh then high. Missing profile effort uses unknown or marked same-model
  proxy evidence, never zero, and does not require reasoning capability.
- A matching profile score takes priority over global benchmark fitness for
  bands, while `user_override` and Arena remain higher priority. Missing
  profile rows fall through to existing global and capability/static sources.
- Coding and general use the agreed reciprocal fallback. Models without
  comparable evidence remain unrated and never overwrite `user_override` or
  `arena_elo` rows.
- Band selection uses the matching profile score before global benchmark
  scores. Direct and inherited `user_override` and Arena scores retain higher
  priority. Missing profile scores fall through existing score sources and
  never write zero.
- The existing strict free-only Structured Output path is the only search
  extraction path. Its output affects ratings only after exact model, URL, and
  literal evidence-quote checks pass.
- Focused tests cover backfill, new IDs, batching/resume, exact evidence,
  normalization, duplicate removal, effort aggregation, fallback, score-source
  priority, cache invalidation, and no-evidence behavior.
