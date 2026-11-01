# Design: compatible structured-output handoff

> Current closure: parent accepted final runtime on 2026-11-01 and authorized
> archiving. Earlier runtime-pending and health-choice statements below are
> historical; selected functional contracts remain unchanged.

## Contract

The native exported row is the source contract:

```json
{
  "id": "provider/model",
  "capabilities": {
    "structured_output": false
  }
}
```

Only a boolean at `capabilities.structured_output` is a compatible declaration.
The internal compatible record uses `structuredOutput?: boolean`, matching the
existing camel-case `supportsTools` and `supportsVision` fields. The synced model
row retains the same internal field. The native API key remains snake case.

An absent key remains absent in a snapshot and synced row. A prior snapshot without
the new key parses normally and still means unknown. Invalid nonboolean values do
not become declarations.

## Handoff

1. `normalizedRecord` reads only `source.capabilities.structured_output` when it is
   a boolean.
2. Snapshot serialization and parsing retain the optional boolean.
3. `persistCompatibleDiscoveredModels` overlays the normalized value onto that raw
   row before `normalizeDiscoveredModels`; discovery writes the optional value to
   its per-connection synced model row.
4. `normalizeSyncedAvailableModel` reads that optional boolean without dropping
   explicit `false`.
5. `getResolvedModelCapabilities` passes compatible structured-output evidence to
   `resolveCompatibleCapabilityOverride`, with its existing higher-priority
   `synced.structured_output` value.

Resolver pseudocode:

```text
if higherPriority is boolean:
    return higherPriority

foundTrue = false
for each current eligible connection:
    require exact provider ID and exact raw model ID membership
    require its snapshot and exact raw model entry
    value = entry.structuredOutput
    if value is false: return false
    if value is true: foundTrue = true

return true if foundTrue else unknown
```

This reuses the existing current active-connection query, per-connection
exclusions, exact ID matching, and false-veto reducer. Compatible snapshot age does
not expire explicit capability evidence. Existing synced model-capability booleans
remain higher priority. No changes to static fallback, provider identity mapping,
pricing, quota, score, or runtime startup are required.

## Verification shape

Offline tests call the real `enrichCatalogModelEntry` exporter using a local
`model_capabilities` fixture, then feed its returned row into
`persistCompatibleDiscoveredModels`. They verify each representation separately:
the exported native key, compatible snapshot, per-connection synced row, and
resolved capability. Every test rejects unexpected `fetch` calls. Additional
resolver cases cover mixed active connections, higher-priority booleans, exact
provider/model isolation, and absence.

The test fixture declares both `true` and `false` directly. It does not claim
APInex sends either value. A missing APInex source field remains unknown.

## Known limits and post-deployment acceptance

APInex normalized snapshots for exact IDs `free/deepseek-v4.1-flash` and
`deepseek-v4.1-flash` omit structured output. Raw payloads were not retained;
normalized absence proves neither raw field loss nor source omission. No backfill
is justified. Reviewer-supplied exact cross-provider DB examples and timestamps
are recorded in `completion.review` and root `openspec/TODO.md`.

Vision false preservation remains separate future work: positive-only emission at
`modelDiscovery.ts:741` and `db/models/synced.ts:140` loses explicit false in synced
rows. The authoritative snapshot retains false and current resolver veto works.
No vision source change is included here.

The existing compatible route at `route.ts:419` fetches catalog GETs only, with up
to three OpenAI-compatible URLs or 20 Anthropic-compatible pages, and no inference.
Persistence also invokes local hooks: `notifyQuotaCombosForProvider` serializes
per-pool upsert/prune of hidden `qtSd` combos (`quotaCombos.ts:237`); changed synced
rows schedule global context-window reconciliation (`contextWindowResolver.ts:104`)
that adds/removes `auto:discovery` overrides. These hooks make no provider requests,
but replay is not pure catalog writes and runtime safety is not established.

Owner authorizes ordinary stock derived combo/override writes during later native
catalog reimport. Before replay, capture a DB backup, current pool membership/config
and combos/overrides before-state. No extra approval gate applies to stock
bookkeeping; do not disable or bypass native hooks. Verify strict free bands remain
unchanged. Compare source boolean presence/value, snapshot, synced row,
resolver, combos, and overrides before/after each active existing connection's
import, then repeat passive GETs against cached rows. Root TODO retains artifact,
deployment, before/after hook-effect proof, and reimport gates. Startup full-overlay choice remains
pending independently. No hook execution is part of this docs correction.

## Existing pricing/catalog API path: planning only

The checked-out native API already exposes authenticated
`POST /api/settings/models-dev` with this exact JSON body:

```json
{ "action": "sync", "dryRun": false, "syncCapabilities": false }
```

Evidence: `src/app/api/settings/models-dev/route.ts:13-18,54-79` validates these
fields and calls `syncModelsDev` with `dryRun` default false and capability sync
true unless explicitly false. `action: "sync"` returns before the separate
`start`/`stop` branches. It does not change settings or call `startPeriodicSync`.
The route does not expose `maxRetries`, `signal`, cache bypass, or a switch to
skip compatible catalogs. Use an existing authenticated dashboard session; the
management bearer alternative can additionally update API-key last-used state,
lazy secret-at-rest backfill, and optional Redis auth cache (`apiAuth.ts:458`,
`db/apiKeys.ts:340,460,1319`). No new auth/config/route/flag is proposed.

The steady-state call graph for an initialized application is:

| Leaf                                                                                                          | Remaining effect with `syncCapabilities:false`                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelsDevSync.ts:200,928-1035`                                                                               | Read the 24-hour in-process models.dev cache or GET `https://models.dev/api.json`; preserve its original `cacheTime` as `fetchedAt`. No force-fresh option is exposed. Default `maxRetries=3` permits four whole attempts, with existing 1/2/4-second failure backoffs.                                                                                                     |
| `modelsDevSync.ts:299-344,968`                                                                                | Unconditionally enumerate existing active compatible node/connection pairs, read/decrypt their stored credentials and configured endpoint/proxy, fetch each catalog, and persist each successful result. Per-connection failure is swallowed and preserves its snapshot; aggregate success does not prove every connection imported.                                        |
| `compatibleModelDiscovery.ts:95-195` / `safeOutboundFetch.ts:88-105`                                          | Catalog GET only: configured OpenAI path is one URL, otherwise up to three distinct URL candidates; Anthropic uses up to 20 pages. Native safe-fetch presets permit two attempts per URL/page, reject redirects, and use timeout/backoff timers. A whole sync retry can repeat successful connection imports. These adapter bounds are not a claim of one provider request. |
| `modelsDevSync.ts:444-479`                                                                                    | Atomically replace `key_value.models_dev_pricing`, merge eligible exact compatible prices, and write canonical `models_dev_zero_price/snapshot` even when capability sync is false. Invalidate pricing/catalog memory caches; request stock local SQLite backup/retention work subject to existing backup settings/throttles. Update in-process sync time/counts.           |
| `db/models/syncedAvailableModelPersistence.ts:24-91`, `db/models.ts:608-620`, `compatibleMetadata.ts:172-203` | Replace/delete changed per-connection `syncedAvailableModels` data; write authoritative compatible snapshot and source time; stamp `provider_connections.synced_models_at` and `updated_at` even on unchanged successful sync. Changed lists schedule the existing unref'd zero-delay reconcile debounce and local backup/cache work.                                       |
| `db/quotaPools.ts:730`, `quota/quotaCombos.ts:172-292`, `contextWindowResolver.ts:104`                        | Stock local per-pool promise queue upserts/prunes hidden `qtSd` combos; changed synced rows reconcile context windows across all persisted synced providers and add/remove `model_context_overrides` with `auto:discovery`, preserving manual overrides. No provider request is made by these hooks.                                                                        |
| `db/combos.ts:39-78`, `db/repositories/sqliteComboRepository.ts:353-390`                                      | Combo updates carrying model steps clear matching `session_model_history`; prune can remove combo-scoped proxy assignments/rotation state and LKGP pins. Combo/cache/backup bookkeeping stays local. Capture these dependent rows too when affected.                                                                                                                        |
| `db/settings.ts:569-846`, `db/proxies/rotation.ts:138,548,576`                                                | Existing proxy resolution may insert/advance local scope-rotation state and update process caches. It does not add provider/connection configuration. Its opt-in fallback caveat is below.                                                                                                                                                                                  |

With `syncCapabilities:false`, `modelsDevSync.ts:952-983` skips capability/identity
transforms, `ensureCapabilitiesTable`/`saveModelsDevCapabilities`, and the dynamic
benchmark catalog refresh. Thus this sync branch does not launch benchmark queue,
search, inference, or model normalization requests. The stock quota promise queue
and pure catalog row normalization above remain; they are not benchmark work.

No persistent periodic sync or context-reconcile interval is started by this
request. A blanket "no timers" claim would be false: existing models.dev abort /
retry timers, safe-fetch timeout/backoff/DNS timers, and changed-row reconcile
zero-delay debounce remain. Local SQLite backup promises and quota maintenance can
outlive the HTTP response. Parent acceptance must wait for and compare their
settled effects without invoking separate jobs or disabling hooks.

There is also a conditional non-catalog-only leaf: after no earlier proxy is
resolved, `db/settings.ts:827` can call `selectWorkingProxyFallback`.
`open-sse/utils/proxyFallback.ts:401-439` gates this on existing
`PROXY_AUTO_SELECT_ENABLED` (default off); with candidates and a cold/expired probe
cache it HEAD-probes `https://api.openai.com/v1/models` through candidate proxies
using existing short timeout timers. This is a provider catalog probe, not
inference, but is outside a claim of only the intended source/provider GETs.
Before any later replay, inspect current proxy configuration/flag and effective
transport path read-only. Do not change config, add a flag, bypass hooks, or execute
this probe here. The source proves the conditional branch, not its current runtime
reachability.

This existing API is a candidate for a one-time post-deployment native catalog /
pricing resync within owner catalog-import authorization, subject to effective
artifact/route verification and the documented before/after DB backup, pricing,
zero snapshot, active-connection catalogs, pool/combo/dependent rows, context
override, and strict-free-band proof. It is not a pure pricing-table write.
Per-connection SO import receipts remain required, even if this call imports some
connections: it can retain failed snapshots while returning aggregate success.
No request was executed for this planning check. A one-time write does not repair
the BASE periodic zero-evidence writer or settle the pending full-OVERLAY startup
choice. No new API, CLI, flag, configuration, or minified-artifact edit is proposed.
