# Design: shared compatible metadata adapter

## Source behavior

The provider model route already owns separate protocol fetch/auth paths for
the two compatible node types and sends discovered model rows through
`buildApiDiscoveryResponse` and the shared `persistDiscoveredModels` path. The
new common layer starts after protocol response decoding and returns one
provider-neutral normalized record per exact upstream model ID. It does not
select providers from names or provider IDs.

The official Anthropic list response documents `data[]`, `display_name`,
`capabilities`, `max_input_tokens`, `max_tokens`, `has_more`, and `last_id`.
Pagination must finish before the current snapshot is replaced. The OpenAI
model-list response documents `data[]` rows with `id`, `object`, `created`, and
`owned_by`; it does not promise price or capability fields. These shapes are
the fixture basis:

- [Anthropic List Models](https://platform.claude.com/docs/en/api/models/list)
- [OpenAI List Models](https://developers.openai.com/api/reference/resources/models/methods/list)

## Shared output contract

```ts
interface CompatibleModelRecord {
  id: string; // exact raw upstream route ID
  name?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  inputDollarsPer1M?: number;
  outputDollarsPer1M?: number;
}

interface CompatibleMetadataSnapshot {
  providerId: string;
  connectionId: string;
  sourceUrl: string;
  fetchedAt: string;
  modelsById: Record<string, CompatibleModelRecord>;
}
```

The adapter maps only documented fields with known meaning. `display_name`
normalizes to `name`; Anthropic `max_input_tokens` and `max_tokens` map to
input/output limits; `capabilities.image_input.supported` maps to explicit
vision support. `server_tools` and other capability objects remain unknown
unless an exact source field maps to an existing normalized capability. Numeric
`dollarsPer1M` and `outputDollarsPer1M` map to input/output price. No other
field names or units are guessed. Raw source IDs remain the sole identity key.

`SyncedAvailableModel` remains the normal capability/availability store.
The current source snapshot lives in one provider-neutral KV namespace, keyed
by exact provider and connection ID. It contains normalized metadata plus
explicit prices, not original JSON. Per-connection snapshots replace only
that connection's current record. The request uses the configured endpoint,
including its query if present; the persisted source URL keeps only origin and
path so query credentials are never retained.

## Endpoint construction

One URL builder serves compatible validation and model discovery:

```text
resolveModelsUrl(baseUrl, modelsPath, defaultPath):
    path = modelsPath if configured else defaultPath
    if path is absolute URL:
        require URL.origin == normalized base URL origin
        return path
    require slash-prefixed path
    return existing base-relative join(baseUrl, path)
```

Existing default paths and relative path behavior stay unchanged. No
cross-origin credential forwarding, parent-path tricks, or endpoint probing
fallback occurs after an explicitly configured path fails.

## Refresh and persistence pseudocode

```text
discovery(providerId, connectionId):
    node = configured node for this exact provider and connection
    require node.type in {"openai-compatible", "anthropic-compatible"}
    url = resolveModelsUrl(node.baseUrl, node.modelsPath, existingDefault(node.type))
    rawPages = existingProtocolFetcher(node.type, url, existingAuth(node))
    require all pages are successful and pagination is complete
    records = normalizeCompatibleMetadata(rawPages)
    synced = normalizeDiscoveredModels(rawPages, providerId)
    persist synced availability through the existing discovery path
    replace this connection's compatible snapshot with one KV upsert
    return records and synced rows to the existing route response builder

periodicModelsDevSync():
    fetch and validate models.dev as today
    for each active compatible node and eligible connection:
        independently try discovery(providerId, connectionId)
        on failure: keep that source snapshot and timestamp unchanged
    atomically save models.dev pricing/capabilities as today
    merge compatible pricing only when every eligible connection for the same
        provider/raw ID has a fresh identical explicit price

readStrictZeroEvidence():
    read models.dev and compatible snapshots without network or writes
    validate each source's timestamp independently
    retain only exact configured provider/connection/raw IDs still synced
    for each provider/raw ID:
        include compatible price only if all eligible connections agree
    compose existing evidence shape with oldest included source timestamp
    let unchanged strictZeroCostFilter decide eligibility
```

All compatible endpoint errors are bounded per node/connection and do not
prevent independent models.dev writes. Failed/incomplete compatible refreshes
never update the source timestamp. A valid empty result replaces only the
corresponding current connection snapshot with an empty model map. Synced model
availability keeps its existing persistence lifecycle; the compatible source
snapshot is updated only after normalization succeeds, and a failed snapshot
write retains its prior source timestamp.

## Supersession

`add-apinex-zero-price-source` and `fix-apinex-native-node-type` record earlier
implementation evidence. Their active spec deltas are replaced with a
supersession notice; their completion receipts remain historical. The
provider-agnostic free-ID binding and all benchmark/routing behavior remain
outside this change.

## Runtime import regression found on merged source

GitHub ARM64 run `40954554580` evaluated the emitted benchmark operator with
`--check-runtime`. Node exited 13 with an unsettled top-level await while the
operator dynamically imported `modelBenchmarkSearch-Y5TC2YLC.mjs`. The log also
shows SQLite initialization before the import stalled. No bundle or metafile
survived the failed ephemeral runner.

The source import graph on main `0c316b924437fb6bd17e4384059896de556d6e61`
shows the new cycle introduced by the compatible discovery dependency:

```text
modelsDevSync
  -> compatibleModelDiscovery
  -> providers/validation/urlHelpers
  -> open-sse/services/claudeCodeCompatible
  -> open-sse/services/contextManager
  -> modelCapabilities
  -> modelCapabilityResolutionSnapshot
  -> modelsDevSync
```

`compatibleModelDiscovery` needs only pure URL/path normalizers, but imports
them from `urlHelpers`; that module imports the high-level Claude runtime
service for its string helpers. The shared metadata adapter therefore closes a
runtime import loop through model capability resolution. Move those pure URL
helpers to a dependency-light module and import it directly from discovery and
the existing callers. Keep protocol fetch/auth code and the benchmark
operator's actual emitted-module evaluation unchanged.

```text
test source dependency graph from compatibleModelDiscovery
assert graph does not reach modelCapabilities or modelsDevSync
assert existing callers retain identical URL normalization results
run focused compatible metadata and benchmark import regressions
assert operator source awaits benchmark import before runtime-check exit
keep Dockerfile --check-runtime evaluating the emitted operator module
trace remaining import-time effects and record their exact source edge
```

After the cycle is removed, a separate pre-existing source path still reaches
usage migrations:

```text
src/lib/modelBenchmarkSearch.ts
  -> src/lib/search/executeWebSearch.ts
  -> open-sse/handlers/search.ts
  -> src/lib/usageDb.ts
  -> src/lib/usage/migrations.ts
```

`usageDb.ts` imports migrations on module load. `migrations.ts` calls
`migrateLegacyUsageFiles()` at module load and, when `shouldPersistToDisk` is
true, awaits `archiveLegacyRequestLogs()` and calls
`migrateUsageJsonToSqlite()`. This path predates TL329 and is outside this
correction. GitHub logs show SQLite initialization but do not identify which
call opened it in that build stage. Do not claim `--check-runtime` is
side-effect-free or change its emitted-module evaluation. A separately
authorized GitHub ARM64 build remains authoritative for the generated module.
