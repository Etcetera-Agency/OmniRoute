## ADDED Requirements

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
