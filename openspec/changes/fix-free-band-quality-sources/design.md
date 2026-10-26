# Design: Use benchmark fitness for free auto bands

## Chosen design

Use a frozen, generated score snapshot keyed by exact global model ID and
calculation profile. The snapshot is based on the agreed unified estimator, not
the separate AA-anchor calibrator. It contains the `low`, `medium`, and `high`
profile outputs captured on 2026-10-25, with source report hashes and per-model
benchmark provenance.

The AA API returns reasoning configurations as separate model rows. Its
documented Free response exposes each row's `id`, `name`, `slug`, and headline
indices; the official example is `gpt-oss-20B (high)` with its own Coding and
Intelligence scores. The schema has no dedicated `reasoning_effort` or
`base_model_id` field. Pro adds a boolean `reasoning_model` and per-benchmark
scores, but the boolean does not identify effort. Reasoning cost and token
counts are usage measures, not effort labels. Read a recognized effort suffix
from the API `name` first; use paired chart suffix metadata only when the name
does not identify one. Group siblings by creator, suffix-stripped name, and
release date, never by slug alone. For a candidate, use the exact effective
mode in its reasoning audit: a mapped `xhigh` selects the `xhigh` row even if
that identity also has a `high` row. Generic high reference identities prefer
`high`, with `xhigh` only as a fallback. Never combine both configurations.

The conditional mapping is:

| Quality band | Calculation profile |
|---|---|
| `low` | `low` |
| `mid` | `medium` |
| `high` | `high` |

The profile is only the effort condition used to calculate fitness. It does
not make reasoning capability a quality requirement. The explicit
`_reasoning` capability predicate remains an independent hard filter when the
channel requests it.

For each profile, the frozen estimator applies these steps:

1. Use AA Coding fitness and AA Intelligence fitness from the selected band
   profile when present. AA is optional per model; preserve AA's exact versus
   estimated/proxy status.
2. For each exact model and benchmark/version, prefer observations matching
   that model's effective effort for the band. If a high-band mapping selects
   `xhigh`, use `xhigh`; when it selects `high`, use `high`. For generic high
   references without a candidate mapping, prefer `high`, then `xhigh`. Do not
   combine both. If the mapped high/xhigh row is absent, use its sibling as a
   marked proxy. If the source omitted effort, use the median of those
   same-model, same-version observations as an effort-unknown proxy. If there
   are no effort-neutral observations, use the median across that exact
   model/version's available efforts and mark `cross_effort_proxy`. Never pick
   the maximum observation.
3. Normalize each supported benchmark metric to a percentage and calculate a
   midrank among distinct model identities in the same benchmark and version.
   Require at least five reference identities; smaller cohorts and singleton
   subsets do not create votes. Keep versions and subsets separate.
4. Deduplicate by exact model identity, benchmark/version, effort, agent, and
   numeric result. Provider/account copies do not add votes. Use only reviewed
   exact aliases; no fuzzy name matching.
5. Reduce benchmark ranks to one median vote per SWE-bench, Terminal-Bench,
   and DeepSWE family. Coding is the median of AA Coding plus available
   benchmark-family votes. Without AA Coding, require two independent
   benchmark families; otherwise coding stays `null`. General is AA
   Intelligence when present.
6. Apply the required reciprocal fallback: missing coding copies general;
   missing general copies coding. If neither exists, the profile stays
   unrated. `null` means no usable evidence; numeric zero is preserved as a
   real measured value. Never fabricate a zero or neutral `.5` value.
7. At runtime, use the numeric score stored for the selected band profile.
   Effort proxies are calculated and marked in the frozen snapshot; runtime
   does not borrow values from another profile. If that profile has no numeric
   evidence, retain the approved `models_dev_tier` capability estimate as the
   next fallback for explicit `:free` requests in all three bands.

Runtime task-fitness precedence remains operator-owned score, Arena score,
inherited global score, matching `benchmark_consensus` profile, existing
models.dev derivation, static table, then wildcard. Both `benchmark_consensus`
and `models_dev_tier` count as rated only for explicit `:free` band requests.
The models.dev value stays marked as a capability estimate and is used only
when the selected profile has no numeric score; a custom rated-source list
cannot make either special source rated for a non-free request.

The snapshot stores one score and evidence summary per exact raw model ID, not
provider/model. If the same raw ID appears through multiple providers, all
profile values must agree; conflicts fail snapshot generation rather than
choosing one provider's score. Models without enough evidence remain absent
from that profile's score map.

## Pseudocode

```ts
function scoreProfileForBand(band) {
  if (band === "mid") return "medium";
  return band; // low -> low, high -> high
}

function benchmarkObservation(model, benchmarkVersion, targetEffort) {
  const rows = exactModelRows(model, benchmarkVersion);
  const preferredEfforts = targetEffort === "high"
    ? ["high", "xhigh"]
    : targetEffort === "xhigh"
      ? ["xhigh", "high"]
      : [targetEffort];
  for (const [index, effort] of preferredEfforts.entries()) {
    const direct = rows.filter((row) => row.effort === effort);
    if (direct.length) {
      const score = median(direct.map((row) => row.score));
      return index === 0 ? score : proxy(score, "sibling_effort_proxy");
    }
  }
  const effortNeutral = rows.filter((row) => row.effort === "unknown");
  if (effortNeutral.length)
    return proxy(median(effortNeutral.map((row) => row.score)), "effort_unknown_proxy");
  if (rows.length)
    return proxy(median(rows.map((row) => row.score)), "cross_effort_proxy");
  return null;
}

function resolveTaskFitness(modelId, task, profile) {
  const override = userOverride(modelId, task);
  if (override) return override;
  const arena = arenaElo(modelId, task);
  if (arena) return arena;
  const inherited = inheritedGlobalScore(modelId, task);
  if (inherited) return inherited;

  if (profile) {
    const benchmark = snapshot[modelId]?.[profile]?.[task];
    if (benchmark != null)
      return { score: benchmark, source: `benchmark_consensus:${profile}` };
  }

  const modelsDev = modelsDevTierFitness(modelId, task);
  if (modelsDev != null) return { score: modelsDev, source: "models_dev_tier" };
  return staticOrWildcardFitness(modelId, task);
}

function isRatedForBand(source, tier, configuredSources) {
  if (source.startsWith("models_dev_tier")) return tier === "free";
  if (source.startsWith("benchmark_consensus:")) return tier === "free";
  return configuredSources.some((item) => source.startsWith(item));
}

function checkBand(candidate, task, band, tier) {
  const profile = scoreProfileForBand(band);
  const { score, source } = resolveTaskFitness(candidate.model, taskKey(task), profile);
  if (!isRatedForBand(source, tier, ratedSources)) return band === "low";
  const { min, max } = getBandRange(task, band);
  return min <= score && score <= max;
}
```

## Safety boundaries

- A benchmark score never changes the model ID, reasoning request, selected
  band, or tier. Band ranges and overlaps stay as configured.
- The `:free` classification, strict zero-cost enforcement, mandatory
  capabilities, provider/account eligibility, exposure, quota, and per-key
  filters continue to apply independently.
- An empty result remains empty. No paid, out-of-band, full-pool, or alternate
  profile fallback is added.
- The snapshot is a relative offline estimate, not a probability of success or
  proof that a provider applies the measured reasoning setting. A models.dev
  fallback remains a capability-based estimate, not a benchmark result.
- Missing measurements stay `null`, never zero. A numeric zero is a real score;
  an effort proxy is numeric only when same-model evidence exists and is marked
  as a proxy. A single benchmark family without AA Coding does not qualify a
  model for mid/high; it remains unrated, rather than receiving an artificial
  low score.
- Successful models.dev sync still invalidates the capability cache. It does
  not refresh benchmark scores.
