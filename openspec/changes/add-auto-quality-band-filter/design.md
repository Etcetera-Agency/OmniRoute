## Context

The seam from `add-auto-band-seam` lets a band channel contribute one predicate
to `buildAutoCandidateFilter`. The predicate sees one candidate at a time
(`virtualFactory.ts:1024`: `candidatePool.filter((candidate) => candidateFilter(candidate))`).

Quality comes from upstream `getTaskFitnessWithSource(model, taskType)`
(`taskFitness.ts:476`). Resolution order: `user_override` → `arena_elo` →
inherited base model → `models_dev_tier` → `fitness_table` → `wildcard_boost`.
Unknown models get `0.5` with source `wildcard_boost`.

What each layer actually holds (`arenaEloSync.ts:107-119,398`,
`taskFitness.ts:164-201`):

| Layer             | Data                                                                                                                                                        | Task keys covered                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `arena_elo`       | Arena leaderboard ELO, normalized to `0.40–0.98`                                                                                                            | "text" board → `default`, `review`, `documentation`, `debugging` (one shared score); "code" board → `coding` |
| `models_dev_tier` | 4 fixed values per task, tier chosen from capability flags (`reasoning` → premium, `tool_call` + context ≥128k → standard, `tool_call` → fast, else budget) | all keys                                                                                                     |
| `fitness_table`   | static per-model table                                                                                                                                      | all keys, but reached only when models.dev has no row                                                        |

Consequences:

- There are two measured quality axes, not seven: "text" and "code".
- `planning` and `analysis` never get an Arena score. They resolve to one of
  four tier values that reflect capability flags, not quality.
- Within one key, Arena scores (continuous) and tier values (four steps) are on
  different scales. A model with no Arena row but `reasoning: true` gets
  `default 0.85` and would sit in `high` next to Arena-top models.

## Goals / Non-Goals

- Goals:
  - Hard upper and lower bound on model quality per channel.
  - Fallback chain stays inside the band.
  - No hot-path I/O; no throw from the predicate.
  - Bands only over measured scores.
- Non-Goals:
  - Tasks beyond `general` and `coding`. Add one when upstream has a real score
    for it.
  - Widening an empty band.
  - Own quality data. The band reads whatever upstream resolves.
  - Radar Intel ELO as a quality source: live tier only, and upstream does not
    feed it into task fitness.

## Decisions

### Band check

```ts
function buildBandCheck(category) {
  const id = parseBandId(category); // null for upstream categories
  if (!id || !isBandsEnabled()) return null;
  const { min, max } = bandRange(id.task, id.band); // config, cached
  const key = id.task === "general" ? "default" : "coding";
  return (c) => {
    try {
      const { score, source } = getTaskFitnessWithSource(c.model, key);
      if (!isRatedSource(source)) return id.band === "low";
      return score >= min && score <= max;
    } catch {
      return false; // fail-closed for the candidate
    }
  };
}
```

### Rated sources

`isRatedSource(source)` is true when the source starts with one of
`ratedSources`, default `["user_override", "arena_elo"]` (this includes the
`:inherited` variants upstream produces for effort and `-free` suffixes).
Everything else is unrated. An unrated model is admitted only to `low`; it is
excluded from `mid` and `high`. It receives no synthetic score, and
calibration uses rated scores only. The reserve is independent of model score.

- A good model that Arena does not list is unrated and can serve only the `low`
  band. Add an upstream user override for that model to make it rated.
- `ratedSources` is config, so `models_dev_tier` can be added back if the pool
  turns out too thin. The calibration report shows the rated share first.

### Capability filters

FMO applied capability as a hard filter before tier on every cell: tool calling
for agentic and `mcp`/`skills` roles, structured output for `approval`, vision
for image work. Upstream only filters per request: tools when the body has
`tools`, structured output when `response_format` is `json_object` or
`json_schema` (and then rejects only models marked `structuredOutput: false`;
unknown passes). A role that needs the capability on every call gets no
guarantee from that.

So capabilities are their own axis in the channel id, separate from task and
band, and enforced statically:

| Segment     | Candidate is kept when                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools`     | `toolCalling` is true and `supportsTools` is not false, or the provider has emulated tool calling (same rule upstream uses for tool-bearing requests) |
| `so`        | `structuredOutput` is true; unknown is rejected unless config `capabilities.so.unknown` is `allow`                                                    |
| `reasoning` | `reasoning` is true or `supportsThinking` is true (same rule as upstream category `reasoning`)                                                        |
| `vision`    | `supportsVision` is true and the model is not vision-bridge-forced (same rule as upstream category `vision`)                                          |

Planning is expressed through `reasoning`, not through a task. Upstream has no
measured `planning` score: its `planning` value is a tier step that is itself
derived from the `reasoning` flag. Asking for the flag directly is the honest
form of the same thing, and the band then orders reasoning models by measured
general quality: `auto/general_high_reasoning:thrifty`.

- Source of truth: upstream `getResolvedModelCapabilities()`, already imported
  by `suffixComposition.ts`.
- Composition: band AND every listed capability AND tier. Upstream's per-request
  compatibility filter still runs afterwards.
- Explicit `:free` keeps upstream provider/model classification semantics. Its
  free-provider override currently admits eligible keyless OpenCode models
  such as `opencode/big-pickle` and `opencode/mimo-v2.5-free`; the ordinary
  model classifier rejects `openrouter/openai/gpt-4.1`. The predicate is
  provider/model-level and does not inspect `connectionId`: if a provider/model
  has both no-auth and credentialed connections, this is not a per-connection
  zero-spend guarantee. That distinct policy is outside this change. Omitted
  band tiers use `thrifty` only while `OMNIROUTE_AUTO_BANDS` is enabled.
- Order in the predicate: capabilities first (cheap, no fitness lookup), then
  band.
- Bands stay quality ranges over the whole observed pool. A capability narrows
  the result; it does not shift the range. A thin cell (few `high` models with
  `so`) shows up in the calibration report and in the candidates listing.

### Thresholds

Built-in defaults, inclusive, overlapping on purpose:

| Band | min  | max  |
| ---- | ---- | ---- |
| low  | 0.00 | 0.55 |
| mid  | 0.45 | 0.80 |
| high | 0.70 | 1.00 |

Config file (path from `OMNIROUTE_AUTO_BANDS_CONFIG`; absent → defaults):

```json
{
  "bands": {
    "low": { "min": 0, "max": 0.55 },
    "mid": { "min": 0.45, "max": 0.8 },
    "high": { "min": 0.7, "max": 1 }
  },
  "tasks": { "coding": { "high": { "min": 0.75, "max": 1 } } },
  "ratedSources": ["user_override", "arena_elo"],
  "capabilities": { "so": { "unknown": "deny" } }
}
```

- `ratedSources`: fitness sources that count as measured.
- Loaded once, re-read at most every 30 s by mtime, off the request path.
- Invalid file → one warning, built-in defaults.
- Defaults are placeholders. Real cut points come from calibration on the
  production pool (tertiles per task, as FMO did): automatic, below, or the
  manual `bands-calibrate.ts` report.

### Automatic recalibration

Scores move: Arena ELO and models.dev syncs run upstream, models connect and
disconnect. Fixed thresholds drift out of date, so ranges can be recalculated
daily. Off by default.

```json
{
  "calibration": {
    "mode": "manual",
    "intervalHours": 24,
    "overlap": 0.05,
    "maxShift": 0.05,
    "minRatedModels": 9,
    "minPerBand": 2
  }
}
```

- **Input**: the band check records which models it evaluated, in memory, last
  24 h — the model id only, not the task and not the verdict. A band channel is
  a shared auto combo: every channel sees the same connected pool, so traffic on
  any one channel is enough to know the pool. The band check is appended after
  the tier checks, so it only sees candidates that already passed the channel
  tier. Current thresholds do not bias the next ones.
- **Calculation**, for every task on each run: resolve the fitness of every
  observed model for that task (off the request path), take the distinct
  numeric score values from rated models, and sort them ascending. Use nearest
  observed score values: `c1 = scores[ceil(0.33*N)-1]` and
  `c2 = scores[ceil(0.67*N)-1]`, where `N` is the number of distinct score
  values. For `N=9`, the cut points are the third and seventh values. Ranges:
  `low [0, c1+overlap]`, `mid [c1−overlap, c2+overlap]`,
  `high [c2−overlap, 1]`.
- **Guards**, per task; a failed guard keeps the previous ranges:
  - fewer than `minRatedModels` rated models observed;
  - any band would hold fewer than `minPerBand` models;
  - a boundary moves at most `maxShift` per run (clamped, not rejected).
- **Trigger**: the first band check after `intervalHours` starts one background
  run. No timer, no startup hook, same pattern as upstream `freeAccessQuota.ts`.
- **Precedence**: operator `tasks.<task>.<band>` > calibrated ranges > operator
  `bands` > built-in defaults. A per-task override is a pin.
- **State**: applied ranges and timestamp are written atomically to
  `auto-bands.state.json` beside the config file, so a restart keeps them and
  `maxShift` has a baseline. The operator config file is never rewritten. With
  no config path set, auto mode stays in memory only.
- **Audit**: one log line per run with old and new boundaries per task and the
  guard outcome.

Alternative considered: host cron running `bands-calibrate.ts --write` daily.
Rejected: the production image is a Next standalone bundle; a `.ts` script that
imports app modules needs `tsx` and the source tree there (not verified on the
image), and it adds a scheduler outside the app. The script stays as a manual
report.

### Empty band is fail-closed

Upstream returns an empty pool when the category filter matches nothing
(`virtualFactory.ts:1036-1055`). The band keeps that behavior.

Alternative considered: stepwise widening. Rejected for this slice — a
per-candidate predicate cannot know the pool is empty; it needs a pool-level
hook at `virtualFactory.ts:1024`, the hottest file. Overlapping defaults and the
`thrifty` tier cover most exhaustion cases. Revisit if empty bands show up in
logs.

`OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL` must stay unset: it would send a
`low` channel to the full pool.

### Weights

Opaque category is not `chat`, so the pool is scored with `quality-first`
(`virtualFactory.ts:1134`), then refined by tier. Inside a band this picks the
best in-band model for the intent-derived task type.

## Risks / Trade-offs

- Many free models are not on the Arena boards → unrated → thin `mid`/`high`
  bands. Mitigation: calibration report shows the rated share per task before
  cutover; unrated models remain available in `low`; user overrides for
  known-good models; `ratedSources` can be
  widened. `ARENA_ELO_SYNC_ENABLED` is on by default upstream.
- Fitness scale shifts after an Arena or models.dev sync → band membership
  moves. Mitigation: automatic recalibration with a per-run shift clamp;
  thresholds stay overridable in config.
- Automatic recalibration changes which models a role gets without a deploy.
  Mitigation: opt-in, `maxShift`, pins, the per-run log line, state file for
  inspection; `mode: "manual"` freezes the last applied ranges.
- Channels with explicit tiers see different pools (`:free` vs `:thrifty`).
  Ranges are per task, computed over the union of rated models seen by all band
  channels, so a model seen through an explicit tier contributes to every
  channel of that task. Default band channels use `:thrifty`.
- No band channel has any traffic for a whole interval → no run, previous
  ranges stay. Nothing is routed in that period, so nothing is affected.
- Scoring uses the intent-derived task type (`coding`/`analysis`/`default`), not
  the channel task. Membership is exact, ordering inside the band is
  approximate. Accepted for this slice.
- Variant ids (`-free`, effort suffixes) inherit base scores through upstream
  `scoresAs`; no handling here.

## Migration Plan

1. Deploy with the flag off; band channels keep degraded resolution.
2. Run `bands-calibrate.ts` on production; write the config file. Later,
   after a week of stable manual ranges, switch `calibration.mode` to `auto`.
3. Check each channel with `GET /v1/auto-combo/<channel>/candidates`.
4. Turn the flag on. Rollback: turn it off.
5. Hermes mapping from the old grid (follow-up, Hermes repo):

| Old combo             | Band channel                        |
| --------------------- | ----------------------------------- |
| `fmo-grid-cod-<tier>` | `auto/coding_<band>:thrifty`        |
| `fmo-grid-int-<tier>` | `auto/general_<band>:thrifty`       |
| `fmo-grid-agt-<tier>` | `auto/general_<band>_tools:thrifty` |
| `fmo-grid-aux-text`   | `auto/general_low:thrifty`          |
| `fmo-grid-aux-tools`  | `auto/general_low_tools:thrifty`    |
| `fmo-grid-aux-struct` | `auto/general_low_so:thrifty`       |
| `fmo-grid-aux-vision` | `auto/general_low_vision:thrifty`   |

Old tiers `low`/`med`/`high` map to bands `low`/`mid`/`high`.

Planning-type roles that had no cell of their own in the old grid (task
decomposition, triage, multi-step plans) take `_reasoning`, combined with
`_tools` or `_so` where the role needs them, e.g.
`auto/general_mid_reasoning_so:thrifty`.

## Required pre-cutover checks

- The calibration report must show Arena rated coverage and structured-output
  capability coverage by channel before Hermes profiles are migrated.
