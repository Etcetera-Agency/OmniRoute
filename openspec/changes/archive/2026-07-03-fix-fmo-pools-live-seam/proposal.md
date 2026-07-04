# Change: Fix FMO pools live seam and diagnostics boundary

## Why

The local FMO pool modules accept and apply `fmo-pools/v1`, but the live AgentBridge
path still only exposes legacy combo-management routes. The 2026-06-29 gate audit
recorded `404` for `/api/fmo/pools` through the bridge, so FMO cannot safely publish
to the new seam in production.

`/api/fmo/usage` must not be a required publisher contract. FMO owns demand through
Hermes inventory/runtime observations and `role_demand_forecasts`; OmniRoute execution
data belongs to diagnostics, decision logs, quota/cooldown, selected model/account, and
tail observability. Feeding OmniRoute partial actual traffic back into FMO demand would
hide outages and rollout gaps by shrinking planned demand.

## What Changes

- Update the API bridge allowlist so FMO can call `PUT/POST /api/fmo/pools` with
  management auth preserved.
- Remove the legacy FMO combo-write bridge allowance after the pool seam is live;
  FMO must not write combo rows directly.
- Require `rebalance.interval_minutes` in the `fmo-pools/v1` payload. FMO chooses
  desired cadence; OmniRoute owns the scheduler and actual execution.
- Reuse OmniRoute's current startup background-service style for scheduling:
  `instrumentation-node` starts an internal timer; no cron, queue worker, or external
  scheduler framework is introduced.
- Make `PUT/POST /api/fmo/pools` atomic ingest plus apply: store accepted generation,
  build the plan, apply combo seating, and report applied status in one flow.
- Treat repeated identical pool publish as manual rebalance trigger: idempotency may
  reuse the stored generation record, but planning/apply still runs every successful
  pool write.
- Delete `POST /api/fmo/rebalance`. Rebalance stays an internal OmniRoute
  job/function driven by the accepted pool generation.
- Remove `/api/fmo/usage` from the required pool-publisher contract.
- Expose OmniRoute execution data through diagnostics/decision-log/rebalance-status
  endpoints, not as FMO demand recalibration input.
- Add a live-seam verification command/test path that proves bridge publish,
  immediate apply, diagnostics availability, and scheduled self-rebalance work before
  cutover.

## Implementation Shape

```txt
apiBridgeServer.isApiBridgeAllowedPath(method, pathname):
  if pathname == /api/fmo/pools and method in PUT|POST|OPTIONS:
    allow
  if pathname matches legacy /api/combos/fmo-* write:
    deny
  keep existing read-only catalog/health paths
```

```txt
PUT/POST /api/fmo/pools:
  require flag + management auth
  validate fmo-pools/v1, including rebalance.interval_minutes
  assert all combo_id refs exist
  store or reuse generation + rebalance cadence under idempotency key
  build plan from accepted generation + current OmniRoute runtime state
  apply combo seating + decision log + apply marker in one transaction
  return { status: accepted, applied: true, generation, marker, diffs }
```

```txt
self-rebalance scheduler:
  starts from instrumentation-node with other background services
  no cron/queue/external scheduler
  inactive until accepted generation exists
  read latest accepted generation
  read latest rebalance.interval_minutes
  on tick, rebuild/apply plan for same generation against current runtime state
  after successful pool publish, refresh next timer from latest interval_minutes
  do not call any FMO endpoint
  do not change demand
```

```txt
execution diagnostics/status:
  require flag + management auth
  expose current accepted generation marker
  expose applied generation marker
  expose last rebalance result / shadow diff / decision-log summary
  expose selected model/account/tail fallback counts where already available
  do not label this data as FMO demand feedback
  do not require FMO publisher to call it
```

## Impact

- Affected spec: `fmo-pool-rebalance`.
- Affected code: `src/lib/apiBridgeServer.ts`, `/api/fmo/pools`, FMO rebalance
  scheduler/internal apply code, diagnostics/status route(s), bridge tests.
- Removes legacy combo write exposure from the bridge for FMO-owned direct writes.
