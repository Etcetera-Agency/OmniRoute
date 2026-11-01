## MODIFIED Requirements

### Requirement: Discover metadata for native compatible nodes

The system SHALL use one provider-agnostic compatible metadata adapter for
configured nodes whose stored type is `openai-compatible` or
`anthropic-compatible`. The adapter SHALL preserve exact provider ID,
connection ID, and raw model ID. It SHALL reuse each protocol's existing
authentication and fetch behavior and the shared model normalization and
persistence path. It SHALL NOT infer metadata from names, IDs, suffixes,
provider branding, canonical provider prices, or free-entitlement labels. When
a source row declares a boolean at the native
`capabilities.structured_output` field, the adapter SHALL preserve that boolean
through its per-connection snapshot and synced model row. The capability
resolver SHALL use the existing current active-connection eligibility and exact
identity rules; an eligible explicit `false` SHALL veto `true`, otherwise
eligible `true` SHALL resolve to `true`, and absent declarations SHALL remain
unknown. Existing higher-priority synced capability booleans SHALL retain
precedence.

#### Scenario: OpenAI-compatible documented model list

- **GIVEN** an active node has stored type `openai-compatible`
- **AND** its model endpoint returns a documented list containing `data[]`
  rows with `id`, `object`, `created`, and `owned_by`
- **WHEN** model discovery completes
- **THEN** each exact `id` is persisted under that node and connection
- **AND** catalog-only fields do not create capability or price evidence

#### Scenario: Anthropic-compatible documented model list

- **GIVEN** an active node has stored type `anthropic-compatible`
- **AND** its model endpoint returns pages with `data[]`, `display_name`,
  `capabilities.image_input.supported`, `max_input_tokens`, `max_tokens`,
  `has_more`, and `last_id`
- **WHEN** every page is fetched successfully
- **THEN** the exact model ID, display name, explicitly represented
  capabilities, and token limits are normalized and persisted
- **AND** unrelated capability details do not become tool-call evidence
- **AND** the full list is recorded as complete

#### Scenario: Explicit capability override

- **GIVEN** a source row explicitly declares a capability as `false`
- **AND** the canonical catalog has the same capability as `true`
- **WHEN** compatible metadata is normalized
- **THEN** the source's explicit `false` remains authoritative

#### Scenario: Metadata does not change provider or model eligibility

- **GIVEN** a compatible metadata response contains a hidden or excluded model
- **WHEN** the current metadata snapshot is replaced
- **THEN** the response does not activate a provider or make the model
  selectable
- **AND** existing visibility and per-connection exclusions remain intact

#### Scenario: Preserve declared structured-output booleans through import

- **GIVEN** the native catalog exporter returns an exact model row with
  `capabilities.structured_output` set to `true` or `false`
- **WHEN** that row passes through compatible import, snapshot persistence, synced
  model persistence, and capability resolution for the same provider, connection,
  and raw model ID
- **THEN** the same boolean is available to the resolver
- **AND** `false` remains authoritative
- **AND** no other provider, connection, or model ID receives that declaration

#### Scenario: Missing structured-output declaration remains unknown

- **GIVEN** the source row has no boolean at
  `capabilities.structured_output`
- **WHEN** compatible metadata is imported and resolved
- **THEN** no structured-output declaration is added to the snapshot or synced row
- **AND** the resolver keeps its existing higher-priority result or unknown result

#### Scenario: Preserve current compatible capability precedence

- **GIVEN** an existing higher-priority synced structured-output boolean and a
  conflicting compatible declaration
- **WHEN** capability resolution runs
- **THEN** the existing higher-priority boolean remains the result
- **AND** absent higher-priority data lets the existing eligible false-veto reducer
  decide the compatible declaration
