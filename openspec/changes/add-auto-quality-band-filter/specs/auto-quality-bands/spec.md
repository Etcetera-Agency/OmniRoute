## ADDED Requirements

### Requirement: Band enforcement switch

Band filtering SHALL run only when `OMNIROUTE_AUTO_BANDS` is `1` or `true`; otherwise band channels use degraded resolution without filtering the pool.

#### Scenario: Disabled enforcement does not filter

- **GIVEN** `OMNIROUTE_AUTO_BANDS` is unset
- **WHEN** A band channel is evaluated
- **THEN** Degraded resolution runs without band filtering

### Requirement: Band membership by task fitness

Membership SHALL use upstream-resolved task fitness with inclusive configured bounds: `general` uses `default`, and `coding` uses `coding`.

#### Scenario: Fitness boundary is inclusive

- **GIVEN** A candidate has task fitness equal to the band minimum
- **WHEN** Membership is evaluated
- **THEN** The candidate is inside the band

### Requirement: Static capability filters

Every declared channel capability SHALL be required on every request. Unknown structured-output support is rejected unless configured to allow unknown; tool emulation and reasoning/thinking flags count as their declared support.

#### Scenario: Every listed capability applies

- **GIVEN** A candidate lacks one of two listed capabilities
- **WHEN** A request evaluates the channel
- **THEN** The candidate is filtered out

### Requirement: Rated and unrated candidates

Only configured rating sources count as rated. Unrated candidates SHALL enter `low` without synthetic scores and SHALL not enter `mid` or `high`.

#### Scenario: Unrated candidate belongs only to low

- **GIVEN** A candidate score comes from an unconfigured source
- **WHEN** All bands evaluate membership
- **THEN** It is admitted to low only and receives no synthetic score

### Requirement: Band configuration

Ranges SHALL load from built-in defaults with optional JSON and per-task overrides; invalid or missing files fall back to defaults, and request handling SHALL perform no disk read.

#### Scenario: Invalid config uses defaults

- **GIVEN** The configured JSON file is invalid
- **WHEN** A request evaluates a band
- **THEN** Built-in ranges are used without request failure

### Requirement: Automatic recalibration

Automatic calibration SHALL update each task off the request path from distinct observed rated scores using nearest-rank 33rd/67th cut points, overlap, minimum-population guards, maximum shift, operator pins, and prior-range fallback on error.

#### Scenario: Manual mode keeps ranges unchanged

- **GIVEN** Calibration mode is manual
- **WHEN** A scheduled calibration opportunity occurs
- **THEN** Configured ranges remain unchanged

### Requirement: Empty band is fail-closed

If no candidate is in the requested band, the result SHALL be an empty pool; the range SHALL NOT widen and the full pool SHALL NOT be used as fallback.

#### Scenario: No in-band candidate returns an empty pool

- **GIVEN** No connected candidate is inside `high`
- **WHEN** A request targets `auto/general_high:free`
- **THEN** The candidate pool is empty and no out-of-band model is dispatched

### Requirement: Fallback stays inside the band

Every fallback target selected for a band request SHALL be a member of that same band.

#### Scenario: Out-of-band model is not a fallback

- **GIVEN** The first in-band candidate fails and stronger out-of-band candidates are connected
- **WHEN** Fallback proceeds
- **THEN** Every attempted target remains in-band

### Requirement: Composition with upstream filters

Band, channel-capability, and tier predicates SHALL combine by logical AND. The band SHALL NOT bypass paid-model hiding, model exposure lists, strict zero-cost policy, ToS guard, per-key exclusions, or the subscription ladder.

#### Scenario: Every upstream guard remains active

- **GIVEN** A candidate is in-band but hidden by the ToS guard
- **WHEN** The combined pool is built
- **THEN** The candidate is excluded

### Requirement: Enable band enforcement only for the configured switch

Band enforcement SHALL be active only when `OMNIROUTE_AUTO_BANDS` is `1` or `true`. When inactive, band channels SHALL use degraded resolution and the band SHALL NOT filter the pool.

#### Scenario: Enforcement on

- **GIVEN** `OMNIROUTE_AUTO_BANDS=1`
- **WHEN** a request targets `auto/coding_mid:free`
- **THEN** the candidate pool contains only models inside the `mid` band for `coding`

#### Scenario: Enforcement off

- **GIVEN** `OMNIROUTE_AUTO_BANDS` is unset
- **WHEN** a request targets `auto/coding_mid:free`
- **THEN** the pool is the upstream pool for category `coding` and tier `free`

### Requirement: Keep band membership inside the task fitness range

A candidate SHALL be inside a band when its upstream-resolved task fitness for the channel task is rated and lies within the band's inclusive `[min, max]` range. Task `general` SHALL use fitness key `default`; task `coding` SHALL use fitness key `coding`.

#### Scenario: In-band candidate

- **GIVEN** band `mid` is `[0.45, 0.80]` and a model's `coding` fitness is 0.70 from `arena_elo`
- **WHEN** the band is checked for `auto/coding_mid`
- **THEN** the candidate is kept

#### Scenario: Candidate above the band

- **GIVEN** band `mid` is `[0.45, 0.80]` and a model's `coding` fitness is 0.92
- **WHEN** the band is checked for `auto/coding_mid`
- **THEN** the candidate is removed

#### Scenario: Boundary value

- **GIVEN** band `mid` is `[0.45, 0.80]` and a model's `coding` fitness is 0.80
- **WHEN** the band is checked for `auto/coding_mid`
- **THEN** the candidate is kept

### Requirement: Filter band candidates by every declared capability on every request

A band channel that lists capabilities SHALL keep only candidates that have every listed capability, on every request, regardless of the request body. Capability `tools` SHALL require tool calling support, with providers that emulate tool calling treated as supporting it.

#### Scenario: Tools filter without tools in the request

- **GIVEN** a request to `auto/general_high_tools:free` whose body has no `tools`
- **WHEN** the candidate pool is built
- **THEN** every candidate supports tool calling and is inside the `high` band for `general`

### Requirement: Require known structured-output support unless unknown support is allowed

Capability `so` SHALL require structured output support known to be true; a candidate whose structured output support is unknown SHALL be removed unless the configuration sets `capabilities.so.unknown` to `allow`.

#### Scenario: Structured output known true

- **GIVEN** three in-band models with structured output support `true`, `false`, and unknown
- **WHEN** a request targets `auto/general_low_so:free`
- **THEN** only the model with support `true` is kept

#### Scenario: Unknown structured output allowed by config

- **GIVEN** configuration `capabilities.so.unknown` is `allow` and an in-band model with unknown structured output support
- **WHEN** a request targets `auto/general_low_so:free`
- **THEN** the model is kept

### Requirement: Require model support for reasoning and vision capabilities

Capability `reasoning` SHALL require a model marked as reasoning or as supporting thinking. Capability `vision` SHALL require vision support known to be true.

#### Scenario: Reasoning filter for a planning role

- **GIVEN** two in-band models, one marked as reasoning and one not
- **WHEN** a request targets `auto/general_high_reasoning:free`
- **THEN** only the reasoning model is kept

#### Scenario: Combined capabilities

- **WHEN** a request targets `auto/general_low_tools_so:free`
- **THEN** every candidate supports both tool calling and structured output

### Requirement: Keep capability filtering independent of task and band ranges

Capability filters SHALL be independent of task and band: they SHALL NOT change band ranges, and the band SHALL NOT relax them.

#### Scenario: Same band with and without a capability

- **GIVEN** band `mid` for `coding` is `[0.45, 0.80]`
- **WHEN** requests target `auto/coding_mid` and `auto/coding_mid_tools`
- **THEN** both use range `[0.45, 0.80]`, and the second pool is the subset of the first that supports tool calling

### Requirement: Classify candidates as rated only from configured rating sources

A candidate SHALL be treated as rated only when its fitness source is one of the configured rated sources, by default a user override or Arena ELO, including scores inherited from a base model through those sources. A score from any other source, including the models.dev tier, the static table, and the wildcard default, SHALL be treated as unrated.

#### Scenario: Tier-derived score is not a rating

- **GIVEN** a model with no Arena row whose score 0.85 comes from the models.dev tier
- **WHEN** the band is checked for `auto/general_high`
- **THEN** the candidate is removed, although 0.85 lies inside the `high` range

#### Scenario: Inherited Arena score is a rating

- **GIVEN** a `-free` variant whose score is inherited from its base model's Arena row
- **WHEN** the band is checked
- **THEN** the candidate is treated as rated

#### Scenario: Rated sources widened by config

- **GIVEN** configuration `ratedSources` includes `models_dev_tier`
- **WHEN** a model scored 0.85 by the models.dev tier is checked for `auto/general_high`
- **THEN** the candidate is kept

### Requirement: Admit unrated candidates to low without synthetic scores

An unrated candidate SHALL be admitted to `low` without assigning it a synthetic score and SHALL be excluded from `mid` and `high`. This rule SHALL NOT be configurable.

#### Scenario: Unrated candidate is admitted to low

- **GIVEN** a model with no fitness data
- **WHEN** the band is checked for `auto/general_low`
- **THEN** the candidate is kept without assigning a score

#### Scenario: Unrated candidate is excluded from mid and high

- **GIVEN** a model with no fitness data
- **WHEN** the band is checked for `auto/general_mid` or `auto/general_high`
- **THEN** the candidate is removed

### Requirement: Load band ranges from configuration without request-path file reads

Band ranges SHALL come from built-in defaults, optionally overridden by a JSON file at the path in `OMNIROUTE_AUTO_BANDS_CONFIG`, with optional per-task overrides. An absent or invalid file SHALL fall back to the built-in defaults and SHALL NOT fail a request. Configuration SHALL NOT be read from disk on the request path.

#### Scenario: Per-task override

- **GIVEN** a config file that sets `tasks.coding.high` to `[0.75, 1]`
- **WHEN** the band is checked for `auto/coding_high`
- **THEN** range `[0.75, 1]` is used

#### Scenario: Invalid file

- **GIVEN** a config file with `min` greater than `max`
- **WHEN** configuration is loaded
- **THEN** built-in defaults are used and one warning is logged

### Requirement: Run scheduled calibration for every task from observed band-channel evaluations

When the configuration sets `calibration.mode` to `auto`, the system SHALL recalculate band ranges per task at most once per `calibration.intervalHours` (default 24) from the models the band check evaluated on any band channel during that period. Every task SHALL be recalculated in each run, whichever channels carried the traffic. A recalculation SHALL NOT run on the request path, SHALL NOT rewrite the operator configuration file, and SHALL keep the previous ranges on any error.

#### Scenario: Daily recalculation

- **GIVEN** `calibration.mode` is `auto`, 24 hours have passed since the last run, 12 observed models are rated for `coding` with cut points 0.48 and 0.74, `overlap` is 0.05, and every boundary is within `maxShift` of its previous value
- **WHEN** the next band check runs
- **THEN** one background recalculation starts and `coding` ranges become `low [0, 0.53]`, `mid [0.43, 0.79]`, `high [0.69, 1]`

#### Scenario: Traffic on one channel calibrates every task

- **GIVEN** `calibration.mode` is `auto` and during the interval only `auto/coding_mid:free` received requests
- **WHEN** a recalculation runs
- **THEN** ranges are recalculated for both `coding` and `general` from the same observed models

#### Scenario: Restart keeps calibrated ranges

- **GIVEN** a recalculation applied new ranges and wrote the state file
- **WHEN** the process restarts
- **THEN** the calibrated ranges from the state file are in effect

### Requirement: Choose nearest-rank cut points from distinct observed rated scores

For each task, the system SHALL take the distinct numeric score values produced by observed rated models and sort them ascending. If that list has `N` entries, the 33rd-percentile cut point SHALL be the observed score at one-based index `ceil(0.33 * N)`, and the 67th-percentile cut point SHALL be the observed score at one-based index `ceil(0.67 * N)`; these are nearest-rank selections and SHALL NOT be interpolated. For `N = 9`, the cut points are the third and seventh distinct scores.

#### Scenario: Cut points use observed nearest-rank distinct scores

- **GIVEN** nine distinct rated score values for `coding` are sorted as `0.40, 0.48, 0.52, 0.60, 0.68, 0.72, 0.74, 0.81, 0.92`
- **WHEN** a recalculation computes the tertile cut points
- **THEN** `c1` is the third distinct score `0.52` and `c2` is the seventh distinct score `0.74`, with no interpolated values

### Requirement: Widen calibrated ranges and keep prior ranges when calibration guards fail

Ranges SHALL be widened by `calibration.overlap`. A recalculation SHALL keep the previous ranges for a task when fewer than `minRatedModels` of the observed models are rated for that task or when a band would hold fewer than `minPerBand` models. A boundary SHALL NOT move more than `calibration.maxShift` in one recalculation.

#### Scenario: Too few rated models

- **GIVEN** only 5 of the observed models are rated for `general` and `minRatedModels` is 9
- **WHEN** a recalculation runs
- **THEN** `general` keeps its previous ranges

#### Scenario: Shift is clamped

- **GIVEN** the previous upper bound of `mid` is 0.80, the newly computed bound is 0.92, and `maxShift` is 0.05
- **WHEN** a recalculation runs
- **THEN** the upper bound of `mid` becomes 0.85

### Requirement: Count every candidate retained in low toward the minimum band population

The `minPerBand` count SHALL count candidates retained by each band's membership rule. In particular, unrated candidates admitted to `low` SHALL count toward `minPerBand`; they SHALL NOT be excluded from that guard merely because they do not contribute a rated score to the percentile calculation.

#### Scenario: Unrated low-band candidates count toward minPerBand

- **GIVEN** auto calibration has one rated model and one unrated model retained in low, with all other calibration guards passing and minPerBand set to two
- **WHEN** the low-band population check runs
- **THEN** both retained candidates count toward minPerBand, so the population guard passes

### Requirement: Respect operator range pins and manual calibration mode

A per-task range in the operator configuration SHALL take precedence over a calibrated range. With `calibration.mode` set to `manual` or unset, ranges SHALL NOT change without a configuration change.

#### Scenario: Operator pin wins

- **GIVEN** the operator config sets `tasks.coding.high` to `[0.75, 1]`
- **WHEN** a recalculation computes a different `high` range for `coding`
- **THEN** range `[0.75, 1]` stays in effect

#### Scenario: Manual mode

- **GIVEN** `calibration.mode` is `manual`
- **WHEN** 24 hours pass and scores change
- **THEN** no recalculation runs and ranges stay as configured

### Requirement: Fail closed when a band contains no candidates

When no candidate remains in the requested band, the system SHALL return an empty candidate pool. It SHALL NOT widen the band or fall back to the full pool.

#### Scenario: No in-band candidate

- **GIVEN** no connected model is inside band `high` for `general`
- **WHEN** a request targets `auto/general_high:free`
- **THEN** the candidate pool is empty and no out-of-band model is dispatched

### Requirement: Keep fallback targets within the requested band

When a candidate in a band fails, fallback targets SHALL remain inside that band.

#### Scenario: First target fails

- **GIVEN** a band channel with three in-band candidates and stronger out-of-band models connected
- **WHEN** the first target fails and routing moves to the next target
- **THEN** the next target is one of the in-band candidates

### Requirement: Compose band filtering with existing upstream filters

Band, capability, and tier predicates SHALL combine by logical AND. Band filtering SHALL NOT bypass paid-model hiding, model exposure lists, strict zero-cost policy, ToS guard, per-key exclusions, or the subscription ladder; upstream free-provider overrides SHALL retain their existing behavior.

#### Scenario: Band and free tier

- **WHEN** a request targets `auto/coding_mid:free`
- **THEN** every candidate is both free-tier and inside the `mid` band

#### Scenario: Explicit free tier includes upstream free-provider overrides

- **GIVEN** the upstream provider override marks OpenCode models as free and the candidate predicate is evaluated for `opencode/big-pickle`, `opencode/mimo-v2.5-free`, and `openrouter/openai/gpt-4.1`
- **WHEN** a request targets `auto/coding_mid:free`
- **THEN** the first two pass the upstream provider/model free-tier predicate and the OpenRouter model does not; this predicate does not distinguish connection IDs or guarantee per-connection zero spend

#### Scenario: Strict zero-cost still applies

- **GIVEN** `freeAccessPolicy` is `strict` and an in-band model fails zero-cost verification
- **WHEN** a request targets `auto/coding_mid:free`
- **THEN** that model is not in the candidate pool
