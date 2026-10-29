## ADDED Requirements

### Requirement: Preserve APInex provider identity fields

The APInex source adapter SHALL treat provider-node ID, stored type, public
prefix, and base URL as separate fields. It SHALL select only a node whose
stored type is exactly `openai-compatible` and whose HTTPS base URL is exactly
`https://api.apinex.bond/v1` (a single trailing slash is accepted). It SHALL
preserve the full stored node ID as the provider evidence key and SHALL NOT
infer type or evidence identity from the ID or public prefix.

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

#### Scenario: Other node type or endpoint

- **GIVEN** a node has a different stored type or endpoint
- **WHEN** APInex prices are bound
- **THEN** no pricing or strict-zero evidence is created for that identity
- **AND** display name, public prefix, and ID prefix do not change the result
