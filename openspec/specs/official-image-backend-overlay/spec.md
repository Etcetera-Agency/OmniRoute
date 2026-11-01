## Purpose

Define how the fork adds backend API routes to the verified official OmniRoute
image while retaining its compiled dashboard and runtime output.

## Requirements

### Requirement: Official dashboard preservation

The image build SHALL retain the official dashboard routes, page bundles,
static assets, and build ID WHEN the fork image is built on the verified
official OmniRoute image.

#### Scenario: Dashboard remains served by official output

GIVEN the official image contains its complete dashboard output
WHEN the backend overlay image is assembled
THEN dashboard route entries continue to point into the official dist tree
AND the official static assets and build ID remain unchanged
AND backend-only stub pages are not selected for UI requests

### Requirement: Isolated backend route loading

The runtime SHALL load an API route's compiled module and relative server
chunks from the isolated backend server subtree WHEN that fork API route is
selected.

#### Scenario: Existing API route uses fork backend

GIVEN an API route key exists in both the official and backend app-path
manifests
WHEN Next.js resolves the route through the merged official app-path manifest
THEN the route resolves to its absolute bundle path in the backend overlay
AND every relative chunk import resolves within that overlay subtree

#### Scenario: Fork adds SystemOne route

GIVEN the backend build contains `/api/v1/systemone/route`
AND the official route manifest contains `/v1/:path*` to `/api/v1/:path*`
WHEN a caller requests `/v1/systemone`
THEN Next.js rewrites the request to `/api/v1/systemone`
AND loads the SystemOne handler from the backend overlay

#### Scenario: Missing backend route blocks image assembly

GIVEN an API route key exists in the official manifest but is absent from the
backend manifest or its bundle file is missing
WHEN the manifest merge runs
THEN the merge fails with the missing route identified
AND no image is produced with a partial backend route set

### Requirement: API runtime configuration merge

The image build SHALL merge backend API function settings and route rewrites
while preserving official UI and non-API configuration.

#### Scenario: API function configuration is updated

GIVEN the official and overlay functions-config manifests contain API routes
AND the official manifest contains UI or non-API entries
WHEN the overlay manifests are merged
THEN overlay API settings take precedence for matching API route keys
AND additional overlay API settings are added
AND official UI and non-API entries remain unchanged

#### Scenario: Rewrite rules are merged once

GIVEN official and overlay route manifests contain the same `/v1/:path*`
rewrite
WHEN the overlay route manifest is merged
THEN the rule appears once
AND unique official and overlay rewrite rules remain available

### Requirement: Overlay manifest integrity

The build SHALL reject malformed route mappings and paths outside the
isolated backend server tree when merging the backend overlay manifest.

#### Scenario: Overlay route path escapes its tree

GIVEN an API manifest value is absolute or traverses outside `server/app/api`
WHEN the merge validates the route bundle
THEN the merge fails with the route key identified
AND the official manifest is not rewritten with that path

### Requirement: Overlay API URL registration

WHEN the backend overlay adds or replaces an API route, the image build SHALL
merge its compiled URL mapping into the root app-path-routes manifest, retain
its isolated bundle mapping in the server app-path manifest, and copy both
merged manifests into the final image. The build SHALL validate API mappings
before output writes and SHALL preserve official dashboard URL mappings.

#### Scenario: New API route is discoverable by HTTP

- **GIVEN** SystemOne exists only in the overlay build
- **WHEN** Next's production filesystem router discovers `/api/v1/systemone`
- **THEN** discovery returns an appFile entry
- **AND** `/v1/systemone` rewrites to that registered route rather than catch-all

#### Scenario: Invalid URL mapping fails assembly

- **GIVEN** an overlay API route lacks a valid matching URL mapping
- **WHEN** manifests are assembled
- **THEN** assembly fails before replacing output manifests

### Requirement: Compiler routing descriptors remain consistent

WHEN overlay API routes are assembled, the image build SHALL merge their
compiled static and dynamic route descriptors by route page, preserve official
UI descriptors, and retain structural rewrite deduplication.

#### Scenario: Compiled routes are retained

- **GIVEN** overlay static and dynamic API descriptors and official UI routes
- **WHEN** route manifests are merged
- **THEN** overlay API descriptors appear once and official UI descriptors remain

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
