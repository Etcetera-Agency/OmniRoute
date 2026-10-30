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

The first source-graph regression found a candidate path from compatible
discovery through validation helpers into Claude runtime/context modules and
back through model capability sync. Pure URL helpers were moved to a shared
dependency-light module, and the regression now proves compatible discovery no
longer reaches validation/runtime or model-sync modules. This was a useful
source-boundary fix, but it did not explain the emitted operator failure: GitHub
run `40960960503` still exited 13 after that change.

GitHub run `40965497429` captured the full generated operator import closure and
metafile at source `ea46cc92b53d211b4830df3b903ccfe5d1e80192`. The extracted
artifact contained 499 `.mjs` outputs matching the metafile exactly. Its
generated `modelBenchmarkSearch-L3DR26C5.mjs` awaits its module initializer,
which awaits `executeWebSearch` before reaching later benchmark dependencies.
The isolated Node 26.12 ARM64 run in existing image config
`sha256:de76b231bfa63b7e2f3dae97e02921411f180fa29dd954c584b0120c3fcb1430`
reproduced exit 13 with the unchanged `--check-runtime` entry. It used no
network, production mounts, environment, key, config, or host database; its
temporary data directory was private container tmpfs.

`async_hooks` on that emitted artifact identified the unresolved initializer
cycle:

```text
contextManager.ts initializer
  awaits init_comboContextLimit()
comboContextLimit.ts initializer
  awaits init_contextManager()
```

The benchmark import reaches this cycle through the existing high-level search
path: `modelBenchmarkSearch` → `executeWebSearch` → auth/provider setup →
`claudeCodeCompatible` → `contextManager`. The source cycle is caused by
`contextManager.ts` re-exporting `resolveComboContextLimit` from
`comboContextLimit.ts`, while `comboContextLimit.ts` imports
`resolveTokenLimit` from `contextManager.ts`. The repair removes the reverse
export edge and updates consumers/tests to import the resolver from its owning
module. `resolveComboContextLimit` logic and all context-limit precedence stay
unchanged:

```text
comboContextLimit.ts -> contextManager.resolveTokenLimit
chatCore.ts -> contextManager helpers and comboContextLimit.resolveComboContextLimit
contextManager.ts -/-> comboContextLimit.ts
```

Keep the operator's actual emitted-module evaluation and Dockerfile
`--check-runtime` guard unchanged. Do not claim source tests prove generated
bundle behavior; a GitHub ARM64 artifact check remains authoritative.

The same runtime trace confirms an existing import-time DB path:

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
correction. The isolated artifact run applied migrations and opened only its
tmpfs SQLite file. Do not claim `--check-runtime` is side-effect-free or change
its emitted-module evaluation. A separately authorized GitHub ARM64 build
remains authoritative for the generated module.
