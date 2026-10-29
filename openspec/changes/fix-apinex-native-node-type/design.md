# Design: APInex native provider-node selection

## Verified identity contract

The canonical provider-node creation schema accepts the exact type
`openai-compatible`. The `provider_nodes` table stores `id`, `type`, `prefix`,
and `base_url` in separate columns; the current create helper writes each field
without deriving one from another. A configured node can therefore have a
generated ID beginning `openai-compatible-chat-`, a stored type of
`openai-compatible`, and a public prefix of `apinex` at the same time.

The strict-zero candidate key is the internal provider ID. Candidate
construction groups on the provider ID, and `strictZeroCostFilter` performs an
exact lookup by `candidate.provider` and raw `candidate.model`. The APInex
adapter must keep the full stored node ID as the evidence key. It must not
replace it with the public prefix or infer its type from the ID.

## Chosen selector

Use one exact native type and one exact endpoint. Keep the selector, node
predicate, and ID binding aligned:

```text
nodes = SELECT id, type, base_url
        FROM provider_nodes
        WHERE type = "openai-compatible"

configured = nodes whose type is exactly "openai-compatible"
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
unchanged. Do not add another type branch or derive type from an ID prefix.
The normal models.dev save continues to merge this current-source snapshot
through the existing exact pricing namespace; the synchronous reader keeps its
existing independent freshness composition.

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

Stub the existing catalog response in the test. Give 21 of the 44 exact raw
IDs numeric zero input and output prices, and give the remaining 23 a nonzero
price. The normal sync must fetch the APInex catalog, persist exactly the 21
matches under the full node ID, and leave all 44 synced records unchanged.
Seed one hidden override for an exact raw ID under native
`modelCompatOverrides` state and verify it remains unchanged after sync. The
public prefix must have no evidence entry; an exact strict-zero candidate
lookup must pass for the full node ID and fail for the prefix. Also reject the
same endpoint under `openai-compatible-chat`, another compatible type, or a
different endpoint.

## Unchanged boundaries

No edits to `strictZeroCostFilter.ts`, candidate generation, provider
availability, hidden/excluded state, band membership, capability or fitness
resolution, the APInex source parser, source freshness, or models.dev save
semantics. Existing independent failure behavior remains covered by the
source-package regressions.
