## ADDED Requirements

### Requirement: Production Webpack filesystem-cache memory retention

OmniRoute SHALL set maxMemoryGenerations to zero for production webpack
compilations that use a filesystem cache, while preserving the filesystem
cache and its existing disk location.

#### Scenario: Production filesystem cache

- **GIVEN** Next.js invokes the OmniRoute webpack callback for a production
  compilation with a filesystem cache
- **WHEN** the callback returns its webpack configuration
- **THEN** maxMemoryGenerations is zero
- **AND** cache type, directory, version, compression, build dependencies,
  and other cache settings retain their incoming values
- **AND** the normal full application compilation and standalone output remain
  enabled

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

#### Scenario: Full production image

- **GIVEN** the approved production webpack cache policy is active
- **WHEN** the normal production image build completes
- **THEN** the image contains the full existing dashboard and API application
- **AND** it contains the existing Next.js standalone output
- **AND** webpack used the filesystem cache at its existing disk location
  during compilation
