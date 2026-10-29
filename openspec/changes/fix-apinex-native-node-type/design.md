# Design: APInex native provider-node selection

## Verified identity contract

The canonical provider-node schema stores `type = "openai-compatible"` for
OpenAI-compatible nodes and stores `apiType` separately. Its API-format values
are `chat`, `responses`, `embeddings`, `audio-transcriptions`, `audio-speech`,
and `images-generations`. The creation route builds the node ID from the
`openai-compatible-` prefix plus `apiType`; therefore
`openai-compatible-chat-<suffix>` is an ID prefix, not a stored type. The table
stores `id`, `type`, `api_type`, `prefix`, and `base_url` in separate columns.
A node can have the generated chat ID prefix, stored type
`openai-compatible`, and public prefix `apinex` at the same time.

The strict-zero candidate key is the internal provider ID. Candidate
construction groups on the provider ID, and `strictZeroCostFilter` performs an
exact lookup by `candidate.provider` and raw `candidate.model`. The APInex
adapter must keep the full stored node ID as the evidence key. It must not
replace it with the public prefix or infer its type from the ID.

## Chosen selector

Use the single accepted OpenAI-compatible stored type and exact APInex
endpoint. Do not use the generated ID prefix or API format as a type check:

```text
nodes = SELECT id, type, base_url
        FROM provider_nodes
        WHERE type = "openai-compatible"

configured = nodes whose stored type is exactly "openai-compatible"
            and base_url is exactly "https://api.apinex.bond/v1"
            (a single trailing slash remains accepted)

for each configured node:
    read syncedAvailableModels keys beginning with node.id + ":"
    collect the exact nonempty raw model.id values already present there

fetch the existing official public catalog once when configured is nonempty
parse its structured exact IDs and numeric prices using the existing adapter
for each node:
    zeroIds = exact catalog IDs with numeric zero input/output and all
              additional reported per-token prices also numeric zero
    boundIds = zeroIds intersect exact synced raw IDs for this same node
    persist boundIds under node.id, preserving source URL and fetchedAt
```

Keep the APInex source URL, parser, timestamp, and source-isolated persistence
unchanged. Do not infer `type` from `apiType` or an ID prefix. The normal
models.dev save continues to
merge this current-source snapshot through the existing exact pricing
namespace; the synchronous reader keeps its existing independent freshness
composition.

## Regression shape

Create a node through the native DB helper with the sanitized live shape:

```text
id = "openai-compatible-chat-fbf9bf6f-8827-4330-a87d-9b5eaf4d30b1"
type = "openai-compatible"
prefix = "apinex"
baseUrl = "https://api.apinex.bond/v1"
connection key prefix = id + ":9565fb26-817c-42b4-baa0-b76733a951c4"
synced raw model count = 44
```

Also create exact-endpoint rows for each other schema-valid `apiType`, with
stored type `openai-compatible`, generated IDs using that format's prefix, and
one synced raw model ID from the same catalog. Stub the existing catalog
response. The normal sync must fetch the APInex catalog, persist the 21
zero-price matches for the 44-model deployed node and the synced exact match
for each other API format, and leave all synced records unchanged. Seed one
hidden override for an exact raw ID under native `modelCompatOverrides` state
and verify it remains unchanged after sync. The public prefix must have no
evidence entry; strict-zero candidate lookups must pass for each full node ID
and fail for the public prefix. Reject `anthropic-compatible` and any node at
a different endpoint.

## Unchanged boundaries

No edits to `strictZeroCostFilter.ts`, candidate generation, provider
availability, hidden/excluded state, band membership, capability or fitness
resolution, the APInex source parser, source freshness, or models.dev save
semantics. The provider-node creation schema remains unchanged. The adapter
does not treat `openai-compatible-chat` or other generated format prefixes as
stored types, and does not bind Anthropic-compatible nodes without a specific
APInex endpoint contract. Existing independent failure behavior remains
covered by the source-package regressions.
