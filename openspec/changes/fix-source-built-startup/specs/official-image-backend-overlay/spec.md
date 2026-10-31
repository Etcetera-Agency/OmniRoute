## ADDED Requirements

### Requirement: Source-built startup instrumentation

WHEN the selected backend overlay is assembled, the official runtime SHALL load
its source-built `server/instrumentation.js` through Next.js's root entry. Keep
the module and relative dependencies inside the isolated runtime overlay tree.

#### Scenario: Final runtime stage retains generated root startup entry

- **GIVEN** the merger generated the root startup delegate
- **WHEN** the actual Dockerfile runtime-stage COPY instructions are applied to
  a fresh official fixture
- **THEN** the final root entry invokes the overlay register implementation
- **AND** its relative startup dependencies resolve within the final overlay
- **AND** official UI output and merged route manifests are retained

#### Scenario: Root instrumentation dispatches into the source-built overlay

- **GIVEN** the selected backend artifact has a compiled instrumentation entry
  and a relative startup chunk under its `server` tree
- **WHEN** the official backend overlay is assembled
- **THEN** the final root `server/instrumentation.js` dispatches to the copied
  entry under `omni-overlay/server`
- **AND** requiring and invoking its `register` resolves the relative chunk
  inside that isolated tree
- **AND** the source-built entry reaches the existing native `registerNodejs`
  implementation exactly once per Next.js Node startup
- **AND** the official dashboard bundles, static assets, and build ID remain
  unchanged

### Requirement: Fail closed when selected startup is unavailable

The merger SHALL fail if the selected or copied startup entry is missing or
resolves outside its designated server tree. It SHALL NOT fall back to official
base instrumentation.

#### Scenario: Missing source-built instrumentation blocks assembly

- **GIVEN** the selected backend server tree has no regular `instrumentation.js`
  entry or its resolved entry escapes that tree
- **WHEN** the overlay merger runs
- **THEN** assembly fails with the startup-entry problem identified
- **AND** official route manifests are not replaced
- **AND** the merger does not fall back to the official base startup entry

### Requirement: Native models.dev startup retains saved opt-in behavior

The existing models.dev startup helper SHALL retain its saved opt-in behavior.
The initial sync remains immediate and nonblocking; successful capability sync
saves raw zero-price evidence before asynchronous public benchmark metadata
refresh.

#### Scenario: Saved opt-in starts immediate sync and metadata refresh

- **GIVEN** `MODELS_DEV_SYNC_ENABLED` is unset and the saved
  `modelsDevSyncEnabled` setting is true
- **WHEN** the existing native startup helper initializes the source-built
  overlay
- **THEN** it registers one models.dev periodic timer and launches the first
  sync immediately
- **AND** a successful capability sync writes pricing and raw zero-price
  evidence once before the asynchronous benchmark metadata refresh
- **AND** the refresh uses only mocked public metadata fetches and does not
  claim benchmark-search work or invoke normalization/inference

### Requirement: Saved paused opt-in suppresses models.dev startup work

When no environment override is set and saved `modelsDevSyncEnabled` is false,
the native startup helper SHALL leave models.dev sync paused.

#### Scenario: Paused saved opt-in performs no sync work

- **GIVEN** `MODELS_DEV_SYNC_ENABLED` is unset and the saved
  `modelsDevSyncEnabled` setting is false
- **WHEN** the existing native startup helper initializes
- **THEN** it registers no periodic timer
- **AND** it performs no models.dev or benchmark metadata fetch
