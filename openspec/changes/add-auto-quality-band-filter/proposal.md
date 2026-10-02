# Change: Enforce quality bands as a candidate-pool filter

## Why

Upstream `auto/*` always pulls toward the best-scoring model. Cheap helper roles
(titles, compression, curation) then spend the quota of the strongest free
models. FMO solved this with a global solve and combo rewrites. A band that caps
the pool from above and below gives the same protection at request time, with no
rebalance and no combo writes.

## What Changes

- `bands/filter.ts` — per-candidate band check on upstream task fitness.
- `bands/capabilities.ts` — static capability filters selected by the channel
  id, independent of task and band: `tools` (tool calling), `so` (structured
  output), `reasoning` (thinking models, for planning-type roles), `vision`. They hold on every request of the channel, whether or not
  the request body carries tools or a response format.
- `bands/config.ts` — band thresholds: built-in defaults, optional JSON file,
  per-task overrides.
- `buildBandCheck()` returns the real check when `OMNIROUTE_AUTO_BANDS` is on.
- Only measured scores count: a model is rated when its score comes from a
  user override or Arena ELO. Scores from the models.dev tier, the static
  table, or the wildcard default are treated as unrated; unrated models are
  admitted only to `low` and excluded from `mid`/`high`, without receiving a
  synthetic score.
- When `OMNIROUTE_AUTO_BANDS` is enabled, band channels without an explicit
  tier default to `thrifty`; with the flag off, they leave the tier unset for
  upstream default handling. An explicit upstream tier retains its existing
  semantics. Only enabled band-channel `thrifty` ordering uses
  `free → keyless → subscription → cheap → premium`.
- Empty band is fail-closed: upstream empty-pool behavior, no widening.
- `bands/calibrate.ts` — automatic recalibration of band ranges, at most once
  per 24 h, from the candidates the band check actually saw. Opt-in
  (`calibration.mode: "auto"`), guarded, and never overrides operator pins.
- `scripts/ad-hoc/bands-calibrate.ts` — manual report of the same calculation
  (fitness distribution and cut points per task), for a first setup and audits.

Upstream eligibility and availability checks remain active: `hidePaidModels`,
model exposure lists, `STRICT_ZERO_COST`, ToS guard, per-key exclusions,
subscription/quota/budget checks, and request compatibility (tools, vision,
structured output, context window). Only the rung priority for enabled band
`thrifty` channels changes; ordinary upstream `auto:thrifty` order stays the
same.

## Impact

- Affected specs: `auto-quality-bands`.
- Affected code:
  - New: `open-sse/services/autoCombo/bands/{filter,capabilities,config,calibrate}.ts`.
  - Changed (fork-only file): `bands/index.ts`.
  - New: `tests/unit/autoCombo/bands-{filter,capabilities,config,calibrate,e2e}.test.ts`.
  - New: `scripts/ad-hoc/bands-calibrate.ts`.
  - `open-sse/services/autoCombo/virtualFactory.ts` (band-only ordering and
    account narrowing).
- Behavior change only when `OMNIROUTE_AUTO_BANDS` is on and only for band
  channels.
- Depends on: `add-auto-band-seam`. Unblocks: `add-auto-band-demand-reserve`.
- Follow-up outside this repo: point Hermes role profiles at band channels.
