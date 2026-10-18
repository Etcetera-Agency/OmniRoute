## ADDED Requirements

### Requirement: Reserve opt-in

Demand reserve SHALL run only when band enforcement and `reserve.enabled` are both active. If reserve is off, static-band behavior SHALL remain available without reserve reads or effects.

#### Scenario: Reserve stays off by default

- **GIVEN** The band feature is enabled but `reserve.enabled` is false
- **WHEN** A band request is made
- **THEN** Static band admission remains active and reserve sources are not read

### Requirement: Demand accounting per band

Reserve demand SHALL use recorded usage grouped by combo name, connection, provider, and model. Band-channel use belongs to its band, other use belongs to `other`, and forecasts SHALL scale lookback use linearly to the target window.

#### Scenario: Band usage contributes to its own forecast

- **GIVEN** Recorded use includes one band combo and one ordinary combo
- **WHEN** The next reserve window is forecast
- **THEN** Band use is charged to its band and ordinary use to `other`

### Requirement: Capacity sources and precedence

Capacity SHALL use the first available source in order: fresh live quota with reset time, catalog daily limits, then catalog monthly token budget. A scope without a usable source has no reserve.

#### Scenario: Fresh quota takes precedence

- **GIVEN** A scope has fresh live quota and a catalog daily limit
- **WHEN** Capacity is selected
- **THEN** The live quota source is selected

### Requirement: Reserve for higher bands

For a non-top band, a candidate account scope SHALL be reserved when higher-band projected need or configured static reserve reaches the applicable capacity safety floor.

#### Scenario: Higher-band demand reaches the floor

- **GIVEN** Higher-band demand is at the configured safety floor
- **WHEN** A lower-band candidate is considered
- **THEN** Its reserved account scope is removed

### Requirement: Top band is never restricted

Demand reserve SHALL NOT remove candidates from the top band, regardless of measured or forecast usage.

#### Scenario: Top-band candidate remains available

- **GIVEN** The requested channel is in the top band and capacity is exhausted
- **WHEN** Reserve filtering runs
- **THEN** The top-band candidate remains in the pool

### Requirement: Non-blocking snapshot

Reserve decisions SHALL read the in-memory snapshot without awaiting I/O. A stale refresh interval starts at most one background refresh, while a snapshot past maximum age is ignored.

#### Scenario: Refresh does not block a decision

- **GIVEN** The snapshot refresh interval has elapsed
- **WHEN** A band decision reads reserve state
- **THEN** The decision uses memory and starts at most one background refresh

### Requirement: Fail-safe to static bands

An error while building or reading reserve data SHALL preserve static band membership and SHALL NOT fail the request.

#### Scenario: Source error keeps static membership

- **GIVEN** The reserve source read fails
- **WHEN** A band request is evaluated
- **THEN** Static membership is used and the request continues

### Requirement: Multi-account candidates

Reserved connection IDs SHALL be narrowed before rung ordering and dispatch. A candidate remains when at least one allowed ID remains; absent, stale, or failed reserve data leaves its allowed IDs unchanged.

#### Scenario: One remaining account keeps the candidate

- **GIVEN** A multi-account candidate has one reserved and one unreserved allowed connection
- **WHEN** Reserve narrowing runs
- **THEN** Only the unreserved connection remains allowed

### Requirement: Read-only use of upstream data

Reserve SHALL use upstream accessors for usage, quota history, and catalog data only. It SHALL NOT write tables or trigger Radar sync, and SHALL work with Radar disabled.

#### Scenario: Radar-disabled catalog remains readable

- **GIVEN** `RADAR_ENABLED` is off and the shipped catalog is available
- **WHEN** Reserve data is read
- **THEN** The catalog is used without sync or writes

### Requirement: Reserve diagnostics

Each refresh started while reserve is enabled SHALL record source counts, per-band reserved-scope counts, unmatched usage share, and duration. Disabled reserve emits no diagnostic.

#### Scenario: Disabled reserve emits no diagnostics

- **GIVEN** Reserve is disabled
- **WHEN** A band request runs
- **THEN** No reserve diagnostic is recorded

### Requirement: Enable demand reserve only when band enforcement and reserve configuration are enabled

The demand reserve SHALL be active only when band enforcement is on and the configuration sets `reserve.enabled` to `true`. When reserve is disabled, the system SHALL perform no reserve calculations, source reads, background refreshes, diagnostics, or account narrowing; enabled static-band behavior continues.

#### Scenario: Reserve off by default

- **GIVEN** band enforcement is on and the config has no `reserve` block
- **WHEN** a request targets `auto/coding_mid:free`
- **THEN** the pool is the static `mid` band with no reserve applied
- **AND** no reserve source is read, calculated, refreshed, or logged

#### Scenario: Disabled reserve starts no work

- **GIVEN** band enforcement is on and `reserve.enabled` is false
- **WHEN** a request targets a band channel
- **THEN** no reserve source read, calculation, refresh, or diagnostic occurs
- **AND** the static band pool is used

### Requirement: Keep band syntax active while the band-enforcement kill switch disables reserve and band policy

When `OMNIROUTE_AUTO_BANDS` is off, band quality/capability filters, custom band-only ordering, reserve calculations, and reserve narrowing SHALL be disabled. The syntax adapter SHALL remain active: it SHALL recognize band IDs, map them to the native category, preserve an explicitly requested tier, and leave an omitted tier unset for the upstream default.

#### Scenario: Kill switch bypasses reserve narrowing

- **GIVEN** `reserve.enabled` is true, `OMNIROUTE_AUTO_BANDS` is unset, the snapshot reserves connection A, and a candidate has `allowedConnectionIds` `[A, B]`
- **WHEN** a request targets the band channel
- **THEN** the adapter maps the band ID to its native category and retains the
  explicit `free` tier
- **AND** quality/capability filters, custom band ordering, and reserve
  narrowing are disabled
- **AND** `allowedConnectionIds` remains `[A, B]`
- **AND** no reserve hook or reserve source read runs

#### Scenario: Kill switch leaves omitted tier to upstream

- **GIVEN** `OMNIROUTE_AUTO_BANDS` is off and a request targets `auto/coding_low`
- **WHEN** the syntax adapter parses the band ID
- **THEN** it maps the request to native category `coding`
- **AND** it leaves the tier unset so upstream tier defaults apply

### Requirement: Account for recorded usage by band and forecast demand linearly

The system SHALL derive demand from recorded usage grouped by combo name, connection, provider, and model over a configurable lookback. Usage whose combo name is a band channel SHALL count toward that band. All other recorded usage SHALL count as `other`. Forecast demand for a window SHALL be the lookback usage scaled linearly to the window length.

#### Scenario: Usage classified by band

- **GIVEN** recorded usage under `auto/general_high:free` and under `auto/coding`
- **WHEN** demand is computed
- **THEN** the first counts toward band `high` and the second toward `other`

#### Scenario: Linear forecast

- **GIVEN** band `high` used 700 requests on a scope over a 7-day lookback
- **WHEN** demand is forecast for a 24-hour window
- **THEN** the forecast is 100 requests

#### Scenario: No history

- **GIVEN** a band channel with no recorded usage
- **WHEN** demand is forecast
- **THEN** its forecast demand is zero

### Requirement: Select capacity from the first available live or catalog source

Capacity SHALL come from the first available source in this order: a fresh live quota snapshot with a known reset time; catalog daily limits; catalog monthly token budget. A scope with none SHALL have no reserve.

#### Scenario: Live snapshot wins

- **GIVEN** a connection with a fresh quota snapshot and catalog daily limits
- **WHEN** capacity is resolved
- **THEN** the live snapshot is used and the catalog limits are ignored

#### Scenario: Daily limits without a snapshot

- **GIVEN** a connection with no quota snapshot and a catalog entry with `rpd` 1000
- **WHEN** capacity is resolved
- **THEN** the daily capacity is 1000 requests

#### Scenario: No capacity data

- **GIVEN** a connection with no snapshot and no catalog entry
- **WHEN** capacity is resolved
- **THEN** the scope has no reserve

### Requirement: Preserve existing daily usage grouping

Existing daily `rpd`/`tpd` grouping SHALL remain unchanged.

#### Scenario: Shared pool

- **GIVEN** two models on one connection with the same catalog pool key
- **WHEN** usage is attributed
- **THEN** both models' usage counts against one scope

### Requirement: Aggregate monthly shared-pool capacity once per account, provider, and pool key

Monthly shared-pool capacity SHALL be keyed by `(account, provider, poolKey)` and SHALL use the maximum known positive `monthlyTokens` value once per key, with catalog entries visited in deterministic `(provider, modelId)` order. Zero and absent values SHALL be treated as unknown and ignored; if no positive value is known, that scope SHALL have no monthly capacity.

#### Scenario: Shared monthly pool uses maximum known capacity once

- **GIVEN** two catalog models for one provider share a pool key on one account and have positive `monthlyTokens` values 10,000 and 20,000
- **WHEN** monthly capacity is resolved
- **THEN** the scope capacity is 20,000 tokens, not 30,000
- **AND** reversing catalog iteration order produces the same scope and capacity

#### Scenario: Provider separates equal monthly pool keys

- **GIVEN** models from two providers on one account have the same pool-key string
- **WHEN** monthly capacity is resolved
- **THEN** each provider has a separate monthly pool scope

#### Scenario: Unknown monthly pool values are ignored

- **GIVEN** catalog models in a shared pool have `monthlyTokens` absent or zero
- **WHEN** monthly capacity is resolved
- **THEN** those values do not create monthly capacity

### Requirement: Determine higher-band reserve as the greater of forecast demand and static reserve

The higher-band reserve SHALL be the larger of forecast demand and the configured static reserve.

#### Scenario: Static reserve without history

- **GIVEN** `staticReservePct.high` is 20, no higher-band history, daily capacity 1000, floor 10%, same-and-lower usage 750
- **WHEN** the reserve is evaluated for band `mid`
- **THEN** the scope is reserved, because 750 + 180 ≥ 900

### Requirement: Reserve absolute-capacity scopes when same-and-lower demand reaches the safety floor

For a band channel below the top band, a candidate SHALL be removed when its account scope is reserved for higher bands. On absolute capacity, a scope SHALL be reserved when usage by the same and lower bands and by `other`, plus the larger of higher-band usage and the higher-band reserve, reaches the capacity less the safety floor.

#### Scenario: Scope reserved on a daily limit

- **GIVEN** daily capacity 1000, floor 10%, higher-band forecast 500, higher-band usage 100, same-and-lower usage 450
- **WHEN** the reserve is evaluated for band `mid`
- **THEN** the scope is reserved, because 450 + 500 ≥ 900

#### Scenario: Scope open on a daily limit

- **GIVEN** daily capacity 1000, floor 10%, higher-band forecast 200, higher-band usage 50, same-and-lower usage 300
- **WHEN** the reserve is evaluated for band `mid`
- **THEN** the scope is not reserved, because 300 + 200 < 900

### Requirement: Reserve live quota connections against projected need before reset

On live capacity, a connection SHALL be reserved when the remaining percentage less the larger of projected higher-band need until reset and the static reserve is at or below the safety floor.

#### Scenario: Connection reserved on live quota

- **GIVEN** 30% remaining, 10 hours to reset, burn 4% per hour, higher-band share 0.6, floor 10%
- **WHEN** the reserve is evaluated for band `low`
- **THEN** the connection is reserved, because 30 − 24 ≤ 10

### Requirement: Never restrict the top band

The reserve SHALL NOT remove any candidate from a channel in the top band.

#### Scenario: High band on an exhausted scope

- **GIVEN** a scope reserved for band `mid` and `low`
- **WHEN** a request targets `auto/coding_high:free`
- **THEN** candidates on that scope stay in the pool

#### Scenario: Top band keeps all account choices

- **GIVEN** a high-band candidate with `allowedConnectionIds` `[A, B]`, where both scopes are reserved for lower bands
- **WHEN** the reserve is evaluated
- **THEN** the candidate and both allowed IDs remain unchanged

### Requirement: Read a non-blocking reserve snapshot and refresh it at most once

When reserve is enabled, decisions SHALL be read from an in-memory snapshot without awaiting I/O. A read past the refresh interval SHALL start at most one background refresh. A snapshot older than the maximum age SHALL be ignored.

#### Scenario: Stale snapshot ignored

- **GIVEN** the last snapshot is older than `maxAgeMinutes`
- **WHEN** a request targets a band channel
- **THEN** no candidate is removed by the reserve

#### Scenario: Concurrent reads

- **GIVEN** the snapshot is past the refresh interval
- **WHEN** ten requests read it at once
- **THEN** exactly one refresh starts

### Requirement: Fall back to static band membership when reserve work fails

Any error while building or reading the reserve SHALL leave band channels on static band membership and SHALL NOT fail the request.

#### Scenario: Refresh throws

- **GIVEN** the usage read throws during a refresh
- **WHEN** the next request targets a band channel
- **THEN** the request is routed with the previous snapshot if still valid, otherwise with static bands only

### Requirement: Narrow candidate account choices before rung ordering and dispatch

A candidate bound to one connection SHALL be removed when that connection's scope is reserved. For a candidate with `allowedConnectionIds`, the reserve SHALL remove each reserved connection ID before rung ordering and dispatch. The candidate SHALL remain when at least one allowed ID remains, with its allowed IDs narrowed to those remaining; it SHALL be removed when no allowed IDs remain.

#### Scenario: Reserved account removed before rung ordering and dispatch

- **GIVEN** a low-band candidate with `allowedConnectionIds` `[A, B]`, where A is reserved and B is not
- **WHEN** the reserve is evaluated
- **THEN** the candidate stays in the pool with `allowedConnectionIds` `[B]` before rung ordering and dispatch

#### Scenario: Candidate removed when all accounts are reserved

- **GIVEN** a candidate with `allowedConnectionIds` `[A, B]`, where both scopes are reserved
- **WHEN** the reserve is evaluated
- **THEN** the candidate is removed from the pool

### Requirement: Preserve account choices when reserve data is missing, stale, or unavailable

If reserve data is missing, stale, or errors, allowed IDs SHALL remain unchanged and the request SHALL follow the fail-safe static-band behavior.

#### Scenario: Missing reserve snapshot preserves account choices

- **GIVEN** a candidate with `allowedConnectionIds` `[A, B]` and no usable reserve snapshot
- **WHEN** the reserve is evaluated
- **THEN** the candidate and both allowed IDs remain unchanged

### Requirement: Read upstream reserve data without causing writes or Radar sync

The reserve SHALL read usage, quota history, and the free-model catalog through upstream accessors only. It SHALL NOT trigger a Radar sync, SHALL NOT write to any table, and SHALL work with `RADAR_ENABLED` off using the shipped catalog.

#### Scenario: Radar off

- **GIVEN** `RADAR_ENABLED` is off
- **WHEN** capacity is resolved for a scope without a live snapshot
- **THEN** only the shipped catalog monthly budget is considered

#### Scenario: No sync side effect

- **WHEN** a reserve refresh runs
- **THEN** no Radar sync function is called and no database write occurs

### Requirement: Record reserve diagnostics only for enabled refreshes

Each refresh started while reserve is enabled SHALL produce a read-only diagnostic record with: scope counts per capacity source, reserved scopes per band, the share of usage that could not be matched to a catalog entry, and the refresh duration. A disabled reserve SHALL produce no diagnostic record.

#### Scenario: Diagnostics available

- **WHEN** a refresh completes
- **THEN** the diagnostic record is logged once and readable from the snapshot
