# Change: Use benchmark fitness for free auto bands

## Why

The current score path can treat capability-derived values like measured task
fitness, and one profile can leak into another. Prefer AA and reviewed benchmark
consensus when a model has matching evidence. Keep the already approved
`models_dev_tier` capability estimate as a marked fallback for missing evidence
in all three free-band profiles.

## What Changes

- Add a versioned score snapshot calculated separately for the `low`,
  `medium`, and `high` band conditions. Select the `low` profile for low,
  `medium` for mid, and `high` for high; do not average across profiles.
- Calculate each profile from AA Coding and AA Intelligence plus deduplicated
  SWE-bench, Terminal-Bench, and DeepSWE measurements. A profile-specific
  benchmark result uses the model's selected effective effort. When the source
  does not report effort, keep the same-model result as an explicitly marked
  proxy. If the mapped high/xhigh row is absent, use its sibling as a marked
  proxy before same-model unknown-effort or cross-effort medians. Never convert
  missing data to zero.
- Do not create benchmark votes from a reference cohort with fewer than five
  unique model identities. Without AA Coding, require at least two independent
  benchmark families before publishing a coding score. Otherwise keep it
  unrated. This prevents one benchmark family from promoting a model into
  mid/high while preserving a genuinely measured numeric zero.
- Normalize each benchmark version independently, give each family one vote,
  and apply the agreed symmetric task fallback. Use the candidate's mapped
  effective effort: a mapped `xhigh` row remains `xhigh` even when a `high`
  sibling exists. For an unmapped high reference, prefer `high` and use
  `xhigh` only when no `high` row exists. Never combine the two efforts.
- Keep score identity global to the exact model ID. Do not add fuzzy aliases or
  provider-qualified scores. Keep missing evidence unrated instead of inventing
  a neutral score.
- Count `benchmark_consensus` as rated only in explicit `:free` bands. Treat
  `models_dev_tier` as a fallback rating only in explicit `:free` bands, for
  low, mid, and high. It must not override a profile-specific AA/benchmark
  score, or become rated through a custom source list on another tier.
- Preserve the current model-capability cache refresh after successful
  models.dev sync; this data remains useful to capability filters and other
  routing decisions.

The reasoning effort attached to each score profile is only a benchmark
calculation condition. It does not change an inference request or require the
candidate to advertise reasoning capability. The existing `_reasoning` filter
remains mandatory only when the channel explicitly requests that capability.

## Non-Goals

- No change to band ranges, strict zero-cost rules, tools/SO/vision capability
  gates, or empty-pool behavior.
- No high-to-mid/low fallback, removal of `:free` or capability suffixes, paid
  fallback, or assignment of reasoning effort by the band filter.
- No background benchmark agent, live database cleanup, push, merge, or deploy.
- No production use of the separate AA-anchor calibration experiment; its
  validation sample and band sensitivity are not stable enough for this change.

## Impact

- Affected behavior: quality membership for explicit free auto bands.
- Affected code: the task-fitness resolver, band predicate, and the existing
  models.dev capability cache invalidation path.
- Verification: focused tests for per-band profile selection, global model IDs,
  free-only rating, unrated capability fitness, and successful-sync visibility.
- The snapshot is offline evidence from 2026-10-25. Automatic refresh and live
  routing acceptance remain separate follow-up work.
