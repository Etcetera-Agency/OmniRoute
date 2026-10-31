# Design: compatible structured-output handoff

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
