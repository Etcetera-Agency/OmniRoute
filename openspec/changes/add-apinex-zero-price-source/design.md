# Design: APInex zero-price source adapter

## Data contract

Official source: `GET https://apinex.bond/api/public/models`.

Expected top-level contract:

```ts
{
  models: Array<{
    id: string;
    dollarsPer1M: number;
    outputDollarsPer1M: number;
    // Additional display and capability fields may be present.
  }>;
  fromDollarsPer1M?: number;
  healthCheckedAt?: string;
}
```

`healthCheckedAt` describes health checks, not price publication time. The
adapter records local `fetchedAt` after the public catalog response succeeds.
`provider`, `name`, `allowFree`, tags, and `free/` prefixes are not price
evidence. Every catalog row must have a unique non-empty `id`, finite
non-negative numeric input/output prices, and finite non-negative numeric
values for every per-token price field with a `DollarsPer1M` suffix. A missing
array, empty catalog, duplicate ID, missing price, string price, or malformed
price invalidates the fetched snapshot. A valid paid or mixed-price row is
catalog data, but never zero-price evidence.

The persisted current APInex snapshot uses existing raw identity data shape
plus provenance:

```ts
{
  sourceUrl: "https://apinex.bond/api/public/models",
  fetchedAt: "<local fetch time>",
  modelsByProvider: {
    "<configured APInex node id>": ["<exact raw API model id>"]
  }
}
```

No historical snapshots or raw catalog payloads are retained.

## Provider binding

An APInex node matches only when its configured node type is the existing
OpenAI-compatible chat type and its configured base URL is HTTPS at
`api.apinex.bond` with path `/v1` (trailing slash may be normalized). Display
name and provider prefix do not participate. The raw provider key is the
configured node ID.

During source refresh, intersect exact APInex catalog `id` values with the
union of that node's existing `syncedAvailableModels` IDs. Do not create or
modify availability rows, model visibility, connection state, or exclusions.

## Source update and pricing merge

On a successful models.dev fetch, attempt APInex refresh independently. A
successful, complete APInex response replaces its current snapshot and adds
only available exact zero-price IDs as `{input: 0, output: 0}` under each
matching node ID in the existing `models_dev_pricing` namespace. A source
failure logs its own warning, leaves prior APInex evidence untouched, and does
not change models.dev's successful result. The models.dev save still replaces
its own catalog rows, then merges the current APInex snapshot without changing
the APInex `fetchedAt`.

```text
if models.dev sync succeeded and is not dry-run:
    nodes = current exact APInex endpoint nodes
    if nodes exist:
        fetch official catalog
        validate every row and its complete numeric price fields
        zeroIds = raw IDs whose published per-token prices all equal numeric 0
        apinexSnapshot = {sourceUrl, local fetchedAt, exact node -> zeroIds ∩ available IDs}
    else:
        do not fetch APInex

    if APInex fetch or validation fails:
        preserve prior APInex snapshot
    pricingRows = current models.dev pricing
    source = new APInex snapshot or prior APInex snapshot
    if source is independently fresh:
        merge only exact source IDs still available under the same exact node ID
    replace models_dev_pricing and models.dev snapshot atomically
    save APInex snapshot only after a successful APInex refresh
```

## Existing zero-price reader composition

The synchronous `getModelsDevZeroPriceEvidence()` reader remains the only
bridge into strict zero-cost evaluation. It reads both persisted snapshots on
every call; it uses no new cache and performs no network request or write.
Reject each source independently when source URL/schema is invalid, its fetch
time is missing, invalid, future-dated, or older than 36 hours, or APInex node
endpoint no longer matches current configuration. Do not reject a valid source
because the other source is missing or stale.

Composition pseudocode:

```text
sources = []
modelsDev = read and validate current models.dev snapshot
apinex = read and validate current APInex snapshot

if modelsDev is independently fresh:
    sources.append(modelsDev)
if apinex is independently fresh:
    retain only node IDs still configured at the exact APInex endpoint
    intersect IDs with each node's current synced available IDs
    if any remain:
        sources.append(the restricted APInex snapshot)
if sources is empty:
    return null

modelsByProvider = exact union of each source's provider -> raw model IDs
fetchedAt = oldest fetchedAt among included sources
return { fetchedAt, modelsByProvider }
```

The unchanged native filter applies its existing exact provider/model match and
36-hour check to this composed input. The minimum timestamp keeps every
included source within that same check. Recomposition on each read lets a
newly stale source disappear while another source remains fresh.

## Failure and persistence rules

- Do not replace APInex snapshot on HTTP failure, invalid JSON, empty list,
  malformed row, duplicate ID, or incomplete price fields.
- Do not use models.dev `fetchedAt` or APInex `healthCheckedAt` as APInex
  provenance.
- Do not persist APInex source data when dry-run is requested.
- An explicit `clearModelsDevPricing()` reset clears the merged pricing namespace
  and both current source snapshots.
- Keep native static budget, quota and hard-stop handling unchanged.
- Keep normal models.dev pricing and capability persistence working when
  APInex is unreachable.
