# Selected design

## Resolution contract

The resolver keeps its current provider-scoped sources and precedence. The
existing native structured-output result wins whenever it is a boolean,
including `false`. The new fallback is consulted only after that result is
`null` or absent.

The fallback inspects existing models.dev capability rows already available in
the build-local `snapshot.synced` map. Runtime calls without a snapshot use the
existing all-row `getSyncedCapabilities()` cache/DB path. It checks only exact
canonical model IDs. The existing `resolveFreePrefixBase()` is the sole special
identity step for a recognized `free/<model>` ID.

For the same exact model ID, one explicit `true` is sufficient. Other provider
rows with `false`, `null`, or no declaration do not alter that result. If no
row explicitly declares `true`, return `null`; existing band policy continues
to reject unknown.

## Pseudocode

```text
native = existing exact provider/connection/model structured-output result
if native is boolean:
    return native

modelId = resolve existing canonical model identity
if modelId is recognized free/<exact catalog model>:
    modelId = existing resolveFreePrefixBase(modelId)

rows = snapshot.synced, when present; otherwise getSyncedCapabilities()
for each provider row in rows:
    capability = row[modelId]
    if capability.structured_output is true:
        return true

return null
```

The lookup does not use `tool_call`, provider aliases as evidence, static
similarity, name-prefix stripping, unanimous agreement, or conflict denial.
Existing provider resolution, own-native overrides, and compatible connection
eligibility remain unchanged.

## Data and failure boundaries

- The only accepted fallback evidence is the normalized models.dev
  `model_capabilities.structured_output` boolean.
- The existing snapshot provides a coherent catalog view. The ordinary
  resolver uses the established models.dev all-row cache, which loads rows from
  the existing SQLite table when that cache is not populated.
- No HTTP, catalog fetch, sync, import, external probe, DB write, or live
  acceptance action is needed.
- Existing `null` behavior remains the fail-closed result for structured-output
  bands.

## Provenance and integration

DATA E013-so-sources supplied one public models.dev metadata GET plus DB
capture: 23 true and 2 false declarations for the same exact model ID. Owner
selected the policy. This implementation used offline fixtures without repeating
that capture.

Full OVERLAY startup is selected. Parent consolidated local acceptance precedes
the already-authorized GitHub build/deploy and passive metadata follow-up.
Fresh inference, forced-tool-call, and billing acceptance are currently forbidden
and are not metadata completion gates.
