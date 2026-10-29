## ADDED Requirements

### Requirement: Accept explicit APInex zero prices

APInex sync SHALL read its official structured public catalog. Every model row
SHALL have a unique non-empty raw ID and finite non-negative numeric input and
output prices. A row is zero-priced only when input and output and every
additional published `DollarsPer1M` price field equal numeric zero. An empty,
malformed, duplicate, or incomplete catalog SHALL not replace the stored
APInex snapshot.

#### Scenario: Explicit zero/zero record

- **GIVEN** the official catalog has a unique raw ID and numeric zero input
  and output prices
- **AND** every additional published per-token price field is numeric zero
- **WHEN** the APInex catalog is parsed
- **THEN** that exact raw ID is eligible as zero-price evidence
- **AND** display provider, name, `allowFree`, tags, and ID prefix do not change
  that result

#### Scenario: Paid, mixed, malformed, or incomplete record

- **GIVEN** a row has nonzero or malformed prices, missing input/output,
  duplicate ID, or empty ID
- **WHEN** the APInex catalog is parsed
- **THEN** the row receives no zero-price entitlement
- **AND** a malformed or incomplete catalog does not replace prior APInex
  source state

### Requirement: Bind APInex prices to existing configured models

The sync SHALL bind exact raw IDs only to a node of type
`openai-compatible-chat` with HTTPS base URL `https://api.apinex.bond/v1`, and
only when that raw ID already exists in the node's synced available-model list.
It SHALL store zero prices under the full node ID and raw model ID in the
existing `models_dev_pricing` shape. It SHALL NOT modify availability,
visibility, connections, exclusions, candidates, or routing.

#### Scenario: Exact configured and available model

- **GIVEN** the node has the exact APInex endpoint and an available model ID
  matches an explicit APInex zero-price raw ID
- **WHEN** APInex pricing is saved
- **THEN** the node ID and exact raw ID receive numeric zero input/output
  pricing and source evidence

#### Scenario: Unconfigured or unavailable identity

- **GIVEN** a match depends on a display label, provider prefix, `free/`
  prefix, different node type/endpoint, or unavailable model ID
- **WHEN** APInex prices are bound
- **THEN** no pricing or strict-zero evidence is created for that identity

### Requirement: Keep APInex refresh independent from models.dev

A failed or invalid APInex fetch SHALL leave prior APInex source URL and fetch
time unchanged and SHALL NOT fail a successful models.dev pricing or capability
sync. A models.dev save SHALL preserve still-fresh APInex zero rows without
changing APInex provenance. A stale APInex source SHALL not be re-added to the
merged pricing namespace on the next models.dev save.

#### Scenario: APInex request or response fails

- **GIVEN** models.dev returns a valid catalog and APInex is unreachable or
  returns an incomplete catalog
- **WHEN** a non-dry-run sync completes
- **THEN** models.dev pricing and capabilities still save successfully
- **AND** prior APInex source state remains unchanged

#### Scenario: Later models.dev save preserves APInex pricing

- **GIVEN** a fresh APInex source snapshot has exact zero rows under a
  configured node ID
- **WHEN** models.dev pricing is replaced by a later successful sync
- **THEN** those APInex rows remain in `models_dev_pricing`
- **AND** the APInex fetch timestamp remains unchanged

### Requirement: Preserve source-specific zero-price freshness

The system SHALL persist APInex source URL and fetch time separately from
models.dev. At each evidence read, it SHALL validate each source independently
under the existing 36-hour limit, omit invalid, future-dated, or stale sources,
and recheck APInex node endpoints and available IDs. It SHALL compose only
fresh exact raw identities with `fetchedAt` equal to the oldest included
source time. The strict filter and policy SHALL remain unchanged.

#### Scenario: Both sources are fresh

- **GIVEN** models.dev and APInex snapshots are valid, fresh, and bind to
  current identities
- **WHEN** strict-zero evidence is read
- **THEN** the returned identities include both sources
- **AND** `fetchedAt` equals the older source timestamp

#### Scenario: One source is stale or future-dated

- **GIVEN** one source is stale or future-dated while the other source is
  independently valid and fresh
- **WHEN** strict-zero evidence is read
- **THEN** invalid source identities are omitted
- **AND** valid source identities remain with their own source timestamp

#### Scenario: Exact freshness boundary

- **GIVEN** a source timestamp is exactly 36 hours old
- **WHEN** strict-zero evidence is read at the same comparison time
- **THEN** that source remains eligible
- **AND** a timestamp older than 36 hours or later than comparison time is
  rejected

#### Scenario: Read does not fetch or refresh sources

- **GIVEN** source snapshots are persisted
- **WHEN** strict-zero evidence is read
- **THEN** the reader performs no network request or write
- **AND** neither source timestamp changes
