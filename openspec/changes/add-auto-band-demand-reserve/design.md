## Context

Inputs that already exist upstream:

| Input               | Accessor                                                                  | Gives                                                                                                        |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Demand              | `getComboForecastUsageRows({ since })` (`src/lib/db/comboForecast.ts:51`) | requests and tokens per combo name, connection, provider, model                                              |
| Live quota          | `getQuotaSnapshots({ since })` (`src/lib/db/quotaSnapshots.ts:110`)       | remaining %, exhausted flag, next reset, per connection and window                                           |
| Documented capacity | `getRadarCatalog()` (`src/lib/radar/index.ts:109`)                        | per provider/model: `monthlyTokens`, `poolKey`, `freeType`, `enabled`; with feed: `limits.rpd`, `limits.tpd` |

Band channels are recorded with combo name equal to the channel id
(`autoRouting.ts:155`), so demand per band needs no new logging.

### What Radar provides

- **Catalog feed** (signed, per model): free regime, budget (`per_model`,
  `shared_pool` with pool id, or `rate_only`), limits `rpm/rpd/tpm/tpd`, context
  window, capabilities with evidence URLs, `trainsOnPrompts`, ToS risk, enabled
  flag, family id. Community tier is about 30 days behind; live tier needs a
  supporter key.
- **Intel feed** (live tier only): Radar-owned ELO per provider/model/category,
  catalog freshness and trend.
- **Offers, referrals, guided combo suggestions**: not relevant here.

Upstream uses Radar for display and counting only. Routing decisions read the
shipped catalog (`freeModels.ts:10-22`). This slice is the first consumer that
uses catalog limits for a routing decision, and it does so only to hold capacity
back, never to admit a model.

`RADAR_ENABLED` is off by default and syncing needs a separate opt-in. With
Radar off, only `monthlyTokens` and `poolKey` are available.

## Goals / Non-Goals

- Goals:
  - Hold back scarce account capacity for higher bands before it is spent.
  - Work with Radar off; improve when it is on.
  - Zero network or disk I/O on the request path.
  - Any failure degrades to the static band.
- Non-Goals:
  - Per-request cost accounting or billing.
  - Own quota research. Capacity facts come from upstream sources only.
  - Letting dispatch use a connection that the reserve has marked unavailable
    for this band.
  - Using Radar Intel ELO for quality.

## Decisions

### Scope

Capacity is tracked per account scope using the existing source-specific
capacity keys:

```
scope = (connectionId, capacityKey)
capacityKey = "pool:" + poolKey                  when the catalog entry has a poolKey
            = "model:" + provider + "/" + modelId otherwise
```

Catalog figures are treated as per-account allowances. The monthly axis adds a
provider component to its shared-pool aggregation key; existing daily capacity
grouping remains unchanged.

### Demand

One refresh reads usage rows for `lookbackDays` (default 7) and for the last
24 h. A third read for 30 d runs only when the monthly axis is on. Each row is
classified by its combo name:

- parses as a band channel → that band;
- anything else → `other`.

Forecast for a window `W`: `D = usage(lookback) × W / lookback` (the same
linear method upstream `comboForecast.ts` uses).

### Capacity precedence

For a scope, the first available source decides; the rest are ignored:

1. **Live**: a quota snapshot for the connection newer than
   `maxSnapshotAgeMinutes` (default 30) with a known `next_reset_at`.
2. **Daily**: catalog `limits.rpd` and/or `limits.tpd` (non-null, > 0).
3. **Monthly**: catalog `monthlyTokens` > 0.
4. **None**: no reserve for this scope; upstream reactive behavior only.

Live wins because it is a measured fact about the whole account, including
traffic OmniRoute did not route.

For monthly capacity, group catalog entries by `(connectionId, provider,
poolKey)` before applying precedence. Visit entries in deterministic
`(provider, modelId)` order and take the maximum known positive
`monthlyTokens` value for each shared pool. Count that result once for the
scope; never sum repeated model-level values. A zero or absent value is unknown
and is ignored. If a pool has no known positive value, it supplies no monthly
capacity. Entries without a pool key remain model-scoped. Existing daily
`rpd`/`tpd` capacity grouping is unchanged.

```ts
for (const entry of catalogEntries.sort(byProviderThenModelId)) {
  const key = entry.poolKey
    ? `${connectionId}:monthly-pool:${entry.provider}:${entry.poolKey}`
    : `${connectionId}:monthly-model:${entry.provider}:${entry.modelId}`;
  if (entry.monthlyTokens == null || entry.monthlyTokens <= 0) continue;
  monthlyCapacity.set(key, Math.max(monthlyCapacity.get(key) ?? 0, entry.monthlyTokens));
}
```

### Reserve rule — absolute axes (daily, monthly)

For channel band `b`, scope `s`, window `W` (24 h or 30 d), capacity `C`:

```
cap          = C × (1 − floorPct/100)
U_above      = usage in last W by bands above b on s
U_rest       = usage in last W by bands ≤ b and by `other` on s
D_above      = forecast demand of bands above b on s for W
R_static     = cap × Σ staticReservePct[band above b] / 100
reserveAbove = max(D_above, R_static)

reserved(b, s)  ⇔  U_rest + max(U_above, reserveAbove) ≥ cap
```

When both `rpd` and `tpd` exist, the scope is reserved if either says so.

### Reserve rule — live axis

For connection `c` and each quota window `k` with a fresh snapshot:

```
R            = latest remaining %
H            = hours until next_reset_at
rate         = %/hour burned over the trailing non-increasing run of snapshots
shareAbove   = token share of bands above b on c over the lookback
needAbove    = rate × shareAbove × H
R_static     = Σ staticReservePct[band above b]

reserved(b, c, k)  ⇔  R − max(needAbove, R_static) ≤ floorPct
```

A connection is reserved for `b` if any of its windows is. The trailing
non-increasing run avoids reading a quota reset as negative burn.

### Predicate

```ts
const parsedBand = parseBandId(requestedId); // syntax adapter remains active
const target = parsedBand
  ? { category: nativeCategory(parsedBand.task), tier: parsedBand.explicitTier }
  : parseUpstreamTarget(requestedId);

if (!isBandsEnabled()) return routeWithUpstreamBehavior(target, upstreamCandidatePool);
if (!reserve.enabled) return applyBandRungOrder(candidatePool, band);

const narrowedPool = candidatePool
  .map((candidate) => applyReserve(candidate, band))
  .filter(Boolean);
return applyBandRungOrder(narrowedPool, band);
```

The syntax adapter remains active with `OMNIROUTE_AUTO_BANDS` off: it recognizes
band IDs, maps them to the native category, preserves an explicitly requested
tier, and leaves an omitted tier unset for the upstream default. In this mode,
disable band quality/capability filters, custom band-only ordering, reserve
calculations, and reserve account narrowing. When bands are enabled but
`reserve.enabled` is false, retain static band behavior and skip all reserve
calculations, source reads, refreshes, and diagnostics. Evaluate both gates
before any reserve work.

- Top band (`high`): `isReserved` is always false.
- Single-connection candidate: reserved when its scope is reserved.
- Candidate with `allowedConnectionIds`: remove reserved connection IDs before
  rung ordering and dispatch; keep the candidate if any allowed ID remains and
  drop it when none remain. This prevents dispatch from selecting a reserved
  account while preserving available accounts on the same candidate.
- No snapshot, snapshot older than `maxAgeMinutes`, or any error: not reserved.

Account narrowing precedes band rung ordering. Narrowing determines which
accounts remain routable; rung order changes candidate priority only. It does
not relax the quality band or add a cost/quality exclusion. Ordinary upstream
channels do not run this band-specific narrowing or ordering.

### Snapshot and refresh

- One immutable in-memory snapshot while enabled:
  `{ builtAt, reserved: Map<band, Set<scopeKey>>, diagnostics }`.
- With reserve enabled, read synchronously. A read past `refreshMinutes`
  (default 10) starts one background refresh; concurrent reads reuse it. No
  timer, no startup hook. With reserve disabled, do not read reserve sources,
  calculate reserve state, refresh, or emit diagnostics.
- Past `maxAgeMinutes` (default 60) the snapshot is ignored.
- First requests after start see no reserve.

### Config

```json
{
  "reserve": {
    "enabled": false,
    "lookbackDays": 7,
    "refreshMinutes": 10,
    "maxAgeMinutes": 60,
    "maxSnapshotAgeMinutes": 30,
    "floorPct": 10,
    "staticReservePct": { "mid": 0, "high": 0 },
    "axes": { "live": true, "daily": true, "monthly": true }
  }
}
```

`staticReservePct` is the cold-start protection: a new high-band role has no
history, so its demand forecast is zero.

## Risks / Trade-offs

- Provider or model ids differ between `call_logs` and the catalog (aliases) →
  usage not matched to capacity. Mitigation: normalize with upstream
  `resolveProviderId`; diagnostics report the unmatched share; contract test.
- Usage rows exclude requests with no combo name (direct model calls) → absolute
  axes undercount. The live axis covers them. Accepted.
- Community-tier Radar limits can be a month old; shipped baseline can be a
  release old. A wrong limit can only over- or under-reserve, never admit a paid
  model.
- Aggregate reads on `call_logs` occur only during refresh while reserve is
  enabled. Measure them against the production database before enabling.
- Reserve is fail-open when snapshot data is unavailable; pre-enable checks
  must confirm account-level narrowing uses the same connection IDs as dispatch.
- Linear forecast lags a sudden demand change by up to the lookback.

## Migration Plan

1. Deploy with `reserve.enabled: false`. This performs no reserve calculation,
   source reads, refresh, or diagnostics; static bands continue to work.
2. Start reserve work only after explicitly setting `reserve.enabled: true`.
   Active refresh diagnostics then describe the sources and scopes used.
3. With Radar off, use live quota data and known shipped monthly catalog
   values. Existing daily `rpd`/`tpd` handling remains unchanged.
4. Rollback reserve by setting `reserve.enabled: false`; this stops reserve
   reads, calculations, refreshes, diagnostics, and account narrowing. Setting
   `OMNIROUTE_AUTO_BANDS` off disables quality/capability filters, custom band
   ordering, and reserve narrowing. The syntax adapter still maps band IDs to
   native categories, retains explicit tiers, and leaves omitted tiers unset.

## Deferred work

- Evaluate a self-hosted Radar feed (`RADAR_FEED_URL`, `RADAR_FEED_PUBKEY`) as
  a home for measured limits in a separate proposal.
- Validate the existing 7-day lookback against weekly Hermes schedules during
  production shadow run; keep the configured timeframe unchanged until that
  evidence is reviewed.
