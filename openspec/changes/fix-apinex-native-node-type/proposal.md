# Change: Select APInex's configured native node type

## Why

The deployed APInex node is stored with `type = "openai-compatible"`, while
the zero-price adapter selects only `openai-compatible-chat`. The configured
node therefore never reaches the already-working public catalog fetch, so no
APInex price evidence is persisted. The provider's public prefix and the
generated full node ID are separate values; neither changes the native `type`
field.

## Selected change

Select only nodes whose stored type is exactly `openai-compatible` and whose
configured base URL is exactly the APInex API endpoint. Keep the full
`provider_nodes.id` as the evidence and pricing key, and intersect official
catalog IDs only with raw model IDs already present in
`syncedAvailableModels` for that node. Reject other node types, endpoints, and
unavailable model IDs.

## What changes

- Correct the APInex adapter's configured-node type predicate to match the
  current provider-node creation schema and deployed record.
- Add a regression using the sanitized native APInex node shape, full node ID,
  public prefix, connection ID, and 44 synced raw model IDs. Verify the public
  catalog fetch and persisted evidence use the full node ID and exact raw IDs.
- Keep freshness, pricing merge, candidate availability, hidden/excluded
  state, strict filtering, and routing behavior unchanged.

## Non-goals

- No alternate or legacy node-type fallback.
- No matching by display name, public prefix, ID prefix, URL substring, or
  model-name heuristic.
- No provider-node, connection, candidate, visibility, hidden-model, pricing
  policy, band, score, or filter mutation.
- No runtime provider request, key access, completion, or deployment.

## Acceptance

- A sanitized native node with `type = "openai-compatible"` and exact APInex
  endpoint is selected and receives source evidence for only its already-synced
  exact raw IDs.
- Evidence and existing `models_dev_pricing` rows remain keyed by the full
  `provider_nodes.id`; the public prefix does not match the strict guard.
- Nodes with another type or endpoint remain excluded.
- Existing APInex parsing, independent freshness, merge, models.dev capability
  sync, strict filter, and hidden/excluded behavior remain unchanged.
