# compatible-model-metadata Specification

## Purpose

Define provider-agnostic metadata discovery, safe endpoint resolution, current snapshots, explicit compatible pricing, and refresh integration for native compatible nodes.

Final shared structured-output fallback is defined separately in
[model-capability-resolution](../model-capability-resolution/spec.md). Missing
compatible declarations remain absent; this adapter does not manufacture a
native boolean or replace that shared resolution contract.

## Requirements

### Requirement: Discover metadata for native compatible nodes

Configured `openai-compatible` and `anthropic-compatible` nodes SHALL share
one metadata adapter using existing protocol authentication/fetch and shared
normalization/persistence. Exact provider, connection, and raw model IDs SHALL
be retained. The adapter SHALL NOT infer metadata from names, IDs, suffixes,
branding, canonical provider prices, or free-entitlement labels.

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

### Requirement: Preserve exact compatible structured-output declarations

A native `capabilities.structured_output` boolean SHALL survive normalization,
per-connection snapshot, and synced row for the exact provider/connection/raw
model. Existing higher-priority synced booleans SHALL win. Otherwise the
existing active-connection reducer SHALL let eligible false veto true,
resolve eligible true to true, and keep absent compatible declarations unknown.

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

### Requirement: Resolve compatible model endpoint safely

The system SHALL use the existing configured `modelsPath` for both compatible
node types. A slash-prefixed relative path SHALL retain existing base-relative
semantics and defaults. An absolute URL SHALL be accepted only when its scheme,
host, and effective port match the configured base URL. Credentials and custom
headers SHALL NOT be sent across origins. A configured endpoint failure SHALL
not silently query a different endpoint and report its metadata as a refresh of
the configured source.

#### Scenario: Existing relative model path

- **GIVEN** a compatible node has a slash-prefixed `modelsPath`
- **WHEN** validation or discovery resolves its model endpoint
- **THEN** both use the same base-relative URL
- **AND** an unset path keeps the existing type-specific default

#### Scenario: Same-origin absolute model endpoint

- **GIVEN** `modelsPath` is an absolute HTTP(S) URL with the configured base
  origin
- **WHEN** validation or discovery resolves the endpoint
- **THEN** the configured absolute URL is used for that request
- **AND** protocol-specific authentication is retained

#### Scenario: Cross-origin absolute model endpoint

- **GIVEN** `modelsPath` is an absolute URL with a different origin
- **WHEN** validation or discovery resolves the endpoint
- **THEN** the configuration is rejected before a credentialed fetch

### Requirement: Replace current compatible metadata snapshots

The system SHALL maintain one replaceable snapshot per exact provider and
connection, containing source URL, fetch time, exact raw IDs, and normalized
metadata. A complete result, including valid empty data, replaces that
connection's snapshot. Failed or incomplete refresh preserves the prior
snapshot and timestamp. Persisted URLs omit query and fragment values. Retain
no history or raw payload.

#### Scenario: Replace with a complete result

- **GIVEN** a complete response contains unique raw IDs or is valid and empty
- **WHEN** the connection's snapshot is replaced
- **THEN** the result replaces only that connection's prior snapshot
- **AND** exact raw IDs are retained

#### Scenario: Keep the previous snapshot after failure

- **GIVEN** a requested page fails or pagination is incomplete
- **WHEN** compatible metadata refresh runs
- **THEN** the prior snapshot and timestamp remain unchanged
- **AND** no partial catalog is recorded as complete

#### Scenario: Do not retain request credentials in source URL

- **GIVEN** the requested endpoint contains query or fragment values
- **WHEN** a successful snapshot is stored
- **THEN** the source URL contains only origin and path
- **AND** no raw response archive or history is retained

### Requirement: Accept only explicit per-million compatible prices

The adapter SHALL accept only explicit finite non-negative per-million input
and output prices. Missing, malformed, or ambiguous-unit fields remain unknown.
It SHALL emit zero-price evidence only when both accepted values equal numeric
zero.

#### Scenario: Explicit unit-bearing prices

- **GIVEN** a compatible model row has explicit numeric per-million input and
  output prices
- **WHEN** the snapshot is normalized
- **THEN** those exact prices are retained under the raw model ID
- **AND** zero-price evidence is emitted only when both values are numeric zero

#### Scenario: Unknown or malformed prices

- **GIVEN** a row omits a price, uses an ambiguous unit, or has a malformed,
  negative, or non-finite value
- **WHEN** the snapshot is normalized
- **THEN** no price or zero-price evidence is created for that field

#### Scenario: Duplicate raw IDs

- **GIVEN** a complete response contains multiple rows with the same raw model
  ID
- **WHEN** the snapshot is normalized
- **THEN** the ambiguous ID is omitted from the replacement snapshot
- **AND** no previous metadata or price for that ID is reused
- **AND** unique rows in the complete response still replace the current snapshot

### Requirement: Apply valid compatible pricing without account leakage

Only valid non-future snapshots for configured nodes, exact connections, and
synced raw IDs SHALL contribute compatible pricing. Age SHALL NOT expire snapshots
or renew fetchedAt. Models.dev/operator precedence SHALL remain unchanged.
Every eligible connection SHALL report complete identical explicit input/output
prices. Missing, malformed, future, or conflicting evidence SHALL be omitted;
nonzero prices SHALL NOT qualify as zero-price evidence. Strict-zero admission
SHALL remain unchanged.

#### Scenario: All eligible connections report explicit zero

- **GIVEN** every eligible connection for one provider/raw ID has a valid non-future
  explicit zero/zero price
- **WHEN** pricing and strict-zero evidence are read
- **THEN** the existing pricing shape receives zero/zero under the exact
  provider and raw ID
- **AND** the exact raw ID is eligible under the existing strict-zero policy

#### Scenario: Connections disagree or one is unknown

- **GIVEN** one eligible connection reports zero while another reports a
  nonzero or unknown price
- **WHEN** pricing and strict-zero evidence are read
- **THEN** compatible evidence for that provider/raw ID is omitted
- **AND** no account's price is promoted to another connection

#### Scenario: Invalid source timestamp is rejected independently

- **GIVEN** one compatible snapshot is future-dated or malformed
- **WHEN** strict-zero evidence is read
- **THEN** that snapshot contributes no identities or pricing
- **AND** any independent valid models.dev evidence retains its own timestamp

#### Scenario: Evidence read is offline and read-only

- **GIVEN** compatible and models.dev source snapshots are persisted
- **WHEN** strict-zero evidence is read
- **THEN** the reader performs no network request or source write
- **AND** source timestamps remain unchanged

### Requirement: Keep compatible refresh independent from models.dev

The existing periodic models.dev sync SHALL refresh active compatible node
metadata through the shared adapter without making models.dev pricing or
capability writes depend on compatible-node availability. A compatible refresh
failure SHALL leave its prior snapshot unchanged. A later models.dev pricing
replacement SHALL merge only current, valid, owned compatible prices and SHALL
not renew their source timestamps.

#### Scenario: Compatible endpoint fails during periodic sync

- **GIVEN** models.dev returns a valid catalog and one compatible endpoint
  fails or is incomplete
- **WHEN** the periodic sync completes
- **THEN** models.dev pricing and capabilities still save
- **AND** that compatible snapshot and timestamp remain unchanged

#### Scenario: Models.dev pricing is replaced

- **GIVEN** a compatible snapshot is current and unambiguous
- **WHEN** a later models.dev pricing save replaces its namespace
- **THEN** exact current compatible prices remain represented
- **AND** compatible source provenance retains its original fetch time without age expiry
