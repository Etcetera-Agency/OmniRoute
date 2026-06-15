# Design: Routing Config UI

## Scope: Two Chains

This change manages routing config for both gateway endpoints with one shared
shape, keyed by endpoint:

```text
endpoint = "search"   // main chain, /v1/search,    provider kind "search"
endpoint = "fetch"    // additional chain, /v1/web/fetch, provider kind "fetch"
```

## Persisted Override Shape

Stored via the existing settings store (`src/lib/db/settings.ts`). One record
per endpoint:

```text
RoutingOverride {
  endpoint: "search" | "fetch"
  order: string[]                 // provider IDs in operator-chosen priority
  disabled: string[]              // provider IDs excluded from automatic routing
  defaultFallback: boolean        // default fallback when request omits the flag
  updatedAt: ISO8601
}
```

A new DB table is only introduced if the settings store cannot hold this record;
prefer the existing key-value settings path to avoid a migration.

## Read-Path Precedence

Both routing read paths resolve the effective order the same way:

```text
effectiveOrder(endpoint, registryDefaultOrder):
  override = loadRoutingOverride(endpoint)
  if !override:
    return registryDefaultOrder
  ordered = override.order.filter(id in registry and id not in override.disabled)
  // append registry providers missing from the override (new providers stay routable)
  for id in registryDefaultOrder:
    if id not in ordered and id not in override.disabled:
      ordered.push(id)
  return ordered
```

`registryDefaultOrder` is the built-in order owned by
`add-hermes-search-routing-support` (search) and the living
`openspec/specs/web-fetch-routing/spec.md` spec (fetch, from the archived
`add-mdream-web-fetch-fallback` change). Disabling does not affect explicit
`provider:` selection — only automatic routing.

## Default Fallback Resolution

```text
effectiveFallback(endpoint, request):
  if request.fallback is set:
    return request.fallback
  return loadRoutingOverride(endpoint)?.defaultFallback ?? builtInDefault
```

The `fallback` request flag keeps the same name/semantics across `/v1/search`
and `/v1/web/fetch` (defined by the routing slices).

## Write Endpoint

```text
PUT /api/search/providers   (management auth)
body: { endpoint: "search" | "fetch", order: string[], disabled?: string[], defaultFallback?: boolean }
```

Validation:

```text
reject unknown provider IDs (not in the endpoint's registry)
reject if order/disabled reference the wrong kind for the endpoint
if every compatible provider would be disabled -> reject OR treat as "use built-in default"
```

GET stays the catalog/status read path; the write path returns the normalized
effective config so the UI can re-render immediately.

## UI

Extend `SearchToolsConfigPane.tsx`, reusing its existing
`kind === "search"` / `kind === "fetch"` split:

```text
- Reorder control (drag handle or up/down) over the active endpoint's providers
- Per-provider enable/disable toggle (disabled = excluded from auto routing, creds kept)
- Endpoint-level "default fallback" toggle
- "Reset to default order" action (clears the override)
- Missing-credential providers stay visible but are not draggable into an enabled-but-unusable state
```

The pane operates on whichever endpoint tab is active (search vs scrape/fetch),
so both the main and additional chains are managed from the same surface.
