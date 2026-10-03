## Purpose

Specify how production webpack builds retain filesystem-cache generations
while preserving the existing disk cache and official UI output.

## Requirements

### Requirement: Production Webpack filesystem-cache memory retention

OmniRoute SHALL set `maxMemoryGenerations` to zero for production webpack
compilations that use a filesystem cache, while preserving the filesystem
cache and its existing disk location.

#### Scenario: Production filesystem cache

- **GIVEN** Next.js invokes the OmniRoute webpack callback for a production
  compilation with a filesystem cache
- **WHEN** the callback returns its webpack configuration
- **THEN** `maxMemoryGenerations` is zero
- **AND** cache type, directory, version, compression, build dependencies,
  and other cache settings retain their incoming values
- **AND** the cache policy does not change application routes or output settings

#### Scenario: Development filesystem cache

- **GIVEN** Next.js invokes the OmniRoute webpack callback for a development
  compilation with a filesystem cache
- **WHEN** the callback returns its webpack configuration
- **THEN** the callback leaves the filesystem cache settings unchanged

#### Scenario: Production non-filesystem cache

- **GIVEN** Next.js invokes the OmniRoute webpack callback for a production
  compilation with a cache type other than filesystem
- **WHEN** the callback returns its webpack configuration
- **THEN** the callback leaves the cache settings unchanged

#### Scenario: Official UI with backend-only overlay

- **GIVEN** the pinned official image contains the full dashboard and
  standalone runtime
- **AND** the fork backend-only build uses the production filesystem-cache
  policy
- **WHEN** the official-image backend overlay is assembled
- **THEN** the image retains the official dashboard routes, page bundles,
  static assets, build ID, and standalone runtime
- **AND** compiled fork API routes are merged from the isolated backend output
- **AND** the final image inherits the official runtime configuration
