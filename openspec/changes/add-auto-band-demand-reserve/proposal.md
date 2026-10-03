# Change: Reserve scarce capacity for higher bands from observed demand

## Why

A static band stops helper roles from using top models, but models that sit in
two overlapping bands, and accounts whose quota is shared across models, are
still first-come-first-served. Upstream reacts only after quota has dropped (the
`quota` scoring factor). FMO planned ahead with a demand forecast built from
declared Hermes schedules. OmniRoute already records the real demand
(`call_logs`), the live quota history (`quota_snapshots`), and the documented
free-tier capacity (shipped catalog, refreshed by Radar when enabled). Combining
them gives a forecast-driven reserve without FMO and without combo rewrites.

## What Changes

- `bands/demand.ts` — demand per band channel, connection, provider and model,
  read through upstream `getComboForecastUsageRows`.
- `bands/capacity.ts` — capacity per account scope, three sources in order:
  1. live quota snapshots (`getQuotaSnapshots`);
  2. daily limits `rpd`/`tpd` from the catalog (present when the Radar feed is on);
  3. monthly token budget `monthlyTokens` from the catalog (always present).
- `bands/reserve.ts` — decides, per band, which account scopes are held back for
  higher bands; result kept in an in-memory snapshot.
- The virtual-factory pool seam narrows a multi-account candidate's
  `allowedConnectionIds` to accounts not reserved for a higher band before the
  band-only rung order and dispatch; candidates with no remaining IDs are
  removed. With `OMNIROUTE_AUTO_BANDS` off, the parser adapter still recognizes
  band IDs, degrades them to the native category, and preserves an explicit
  tier; omitted tiers remain unset for the upstream default. Quality/capability
  filters, custom band ordering, and reserve narrowing are disabled.
- Config block `reserve` in the bands config file; off by default.
- While reserve is disabled, do no reserve calculations, source reads,
  background refreshes, or diagnostics. Read-only diagnostics are available
  only for a refresh started while reserve is explicitly enabled.
- When bands are disabled, disable band quality/capability filters,
  custom ordering, and reserve narrowing while retaining the approved syntax
  adapter and upstream routing behavior.

The catalog is read through `getRadarCatalog()`, which returns the shipped
baseline when `RADAR_ENABLED` is off. The feature never triggers a Radar sync
and never writes Radar tables.

## Impact

- Affected specs: `auto-quality-bands`.
- Affected code:
  - New: `open-sse/services/autoCombo/bands/{demand,capacity,reserve}.ts`.
  - Changed (fork-only files): `bands/filter.ts`, `bands/config.ts`.
  - New: `tests/unit/autoCombo/bands-{demand,capacity,reserve}.test.ts`.
  - Uses the shared `virtualFactory.ts` integration point; no other upstream
    file, migration, or new table is added.
- Reads (no writes): `call_logs`, `quota_snapshots`, Radar cache.
- Behavior change only when both `OMNIROUTE_AUTO_BANDS` and `reserve.enabled`
  are on, and only for band channels below the top band.
- A shared monthly catalog pool uses the maximum known positive
  `monthlyTokens` value once per account, provider, and pool key. Missing and
  zero values are unknown and do not create capacity.
- Depends on: `add-auto-band-seam`, `add-auto-quality-band-filter`.
