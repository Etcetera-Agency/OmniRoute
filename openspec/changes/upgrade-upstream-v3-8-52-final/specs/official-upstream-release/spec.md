## ADDED Requirements

### Requirement: Build the fork overlay from the final v3.8.52 source and image

The fork release branch SHALL include official `v3.8.52` source commit
`ad6f33f66bda34eba98645d3bfdabbde294bc843` and SHALL pin both overlay base
references to the OCI index
`sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c`.
The Linux ARM64 child digest SHALL be recorded as
`sha256:fb7f91836fd95f382a5a04af740d859e2e9731804b5c0ba43f5d2e7f9ad64794`.

#### Scenario: Source and runtime are the same release

- **GIVEN** the fork overlay source tree and its official backend base
- **WHEN** release provenance is prepared
- **THEN** the source identifies final official tag `v3.8.52` at the required
  commit
- **AND** workflow and Dockerfile reference the required immutable OCI index
  digest
- **AND** the selected native ARM64 platform resolves to the recorded child
  digest

### Requirement: Preserve unique migration identities across the upstream update

The fork SHALL keep deployed fork migration versions 197–199 unchanged, map
official upstream migrations 197–212 in order to versions 200–215, and map the
not-yet-deployed fork migration 200 to version 216. The migration runner,
numbering checks, overlay verifier, and tests SHALL use that same mapping. The
runtime overlay migration directory SHALL contain the reviewed source set
without the official base's original 197–212 files.

#### Scenario: Existing fork ledger advances through both sources

- **GIVEN** the existing fork migration ledger contains fork migrations
  197–199
- **WHEN** the upgraded runner enumerates pending migrations
- **THEN** it leaves the meaning and names of applied fork versions 197–199
  unchanged
- **AND** it orders official versions 200–215 by their original upstream order
- **AND** it applies pending benchmark migration 216 after those upstream files
- **AND** it finds no duplicate numeric prefix or unreviewed original upstream
  migration file

#### Scenario: The overlay exposes the exact reviewed migration set

- **GIVEN** the candidate is assembled from the pinned official base
- **WHEN** the Dockerfile replaces `/app/migrations` with source migrations
- **THEN** the runtime inventory equals the reviewed source inventory
- **AND** none of the base's original official 197–212 files remain
