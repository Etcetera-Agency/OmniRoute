## ADDED Requirements

### Requirement: Preserve APInex provider identity fields

The APInex adapter SHALL select only nodes with stored type
`openai-compatible` and the exact APInex HTTPS base URL. It SHALL preserve the
full node ID as provider key and bind only exact synced raw model IDs. It SHALL
NOT infer type or evidence identity from API type, node ID prefix, or public
prefix.

#### Scenario: Native APInex identity has a distinct public prefix

- **GIVEN** a node has stored type `openai-compatible`, the exact APInex
  endpoint, full ID `openai-compatible-chat-fbf9bf6f-8827-4330-a87d-9b5eaf4d30b1`,
  and public prefix `apinex`
- **AND** a current synced raw model ID matches an explicit APInex zero-price
  catalog ID
- **WHEN** APInex pricing is saved
- **THEN** the full node ID and exact raw ID receive numeric zero input/output
  pricing and source evidence
- **AND** the public prefix does not replace the provider ID
- **AND** availability, visibility, and exclusions remain unchanged

#### Scenario: API format remains separate from the stored type

- **GIVEN** a node has stored type `openai-compatible`, a schema-valid API
  type such as `responses`, and an ID generated with the corresponding API
  format prefix
- **AND** the exact APInex endpoint and a synced raw model ID matching an
  explicit APInex zero-price catalog ID
- **WHEN** APInex pricing is saved
- **THEN** the full node ID and exact raw model ID receive numeric zero input
  and output pricing and source evidence

#### Scenario: Other node type or endpoint

- **GIVEN** a node has stored type `anthropic-compatible` or a different
  endpoint
- **WHEN** APInex prices are bound
- **THEN** no pricing or strict-zero evidence is created for that identity
- **AND** display name, public prefix, and ID prefix do not change the result
