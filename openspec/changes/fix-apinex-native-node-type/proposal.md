# Change: Select APInex's configured native node type

## Why

The deployed APInex node is stored with `type = "openai-compatible"`, while
the zero-price adapter selects only `openai-compatible-chat`. That string is
the generated ID prefix for `apiType = "chat"`, not a supported stored node
type. The configured node therefore never reaches the already-working public
catalog fetch, so no APInex price evidence is persisted. Select the exact
stored type and endpoint; keep full node ID and synced raw model binding.

## Selected change

Select only nodes whose stored type is exactly `openai-compatible` and whose
configured base URL is exactly the APInex API endpoint. `apiType` formats the
request path and generated ID; it does not change stored type or pricing
identity. Keep the full `provider_nodes.id` as the evidence and pricing key,
and intersect official catalog IDs only with raw model IDs already present in
`syncedAvailableModels` for that node. Reject Anthropic-compatible nodes,
other endpoints, and unavailable model IDs.

## What changes

- Correct the APInex adapter selector to use the stored OpenAI-compatible type.
- Add a regression using the deployed native node shape and every schema-valid
  OpenAI `apiType`; verify generated ID formats do not change stored type,
  catalog evidence uses full node IDs, and only exact synced raw IDs bind.
- Keep freshness, pricing merge, candidate availability, hidden/excluded
  state, strict filtering, and routing behavior unchanged.

## Non-goals

- No inference of stored type from API format or generated ID prefix.
- No matching by display name, public prefix, ID prefix, URL substring, or
  model-name heuristic.
- No provider-node, connection, candidate, visibility, hidden-model, pricing
  policy, band, score, or filter mutation.
- No runtime provider request, key access, completion, or deployment.

## Acceptance

- Sanitized nodes with stored type `openai-compatible`, any schema-valid
  `apiType`, and the exact APInex endpoint are selected and receive source
  evidence only for their already-synced exact raw IDs.
- Evidence and existing `models_dev_pricing` rows remain keyed by the full
  `provider_nodes.id`; the public prefix does not match the strict guard.
- Anthropic-compatible nodes and nodes with another endpoint remain excluded.
- Existing APInex parsing, independent freshness, merge, models.dev capability
  sync, strict filter, and hidden/excluded behavior remain unchanged.
