## ADDED Requirements

### Requirement: Pass and validate the full source SHA before backend compilation

The main image workflow SHALL pass its exact full source commit SHA as `OMNIROUTE_BUILD_SHA`. After copying source and before backend compilation or stamp writing, the backend builder SHALL require exactly 40 lowercase hexadecimal characters.

#### Scenario: Builder stamps the requested source revision

- **GIVEN** the workflow supplies a full lowercase 40-character source SHA
- **WHEN** the regular backend builder compiles and stamps the overlay
- **THEN** `.build/backend-overlay/server/BUILD_SHA` contains that exact SHA
- **AND** the selected-server check accepts it before final image assembly

#### Scenario: Invalid source SHA stops before compilation

- **GIVEN** the build argument is empty, short, too long, uppercase, or
  contains non-hexadecimal characters
- **WHEN** the backend builder validates the argument after source copy
- **THEN** the Docker build fails before backend compilation
- **AND** no BUILD_SHA sentinel is written

### Requirement: Keep the dependency-install stage independent from source revision

The dependency-install stage SHALL remain independent of `OMNIROUTE_BUILD_SHA` so source revisions do not invalidate dependency installation.

#### Scenario: Dependency installation stays reusable across source revisions

- **GIVEN** two builds use different valid source SHAs and the same dependency lockfile
- **WHEN** the dependency-install stage is evaluated
- **THEN** the stage input remains independent of the source SHA

### Requirement: Write the validated source SHA into the selected backend server tree before merging

The regular backend builder SHALL reuse the existing build-stamp writer and place the validated SHA at `.build/backend-overlay/server/BUILD_SHA`. The selected server tree SHALL contain a valid `BUILD_SHA` equal to the build argument before route merging and final runtime image creation. This check SHALL also apply when the existing `prebuilt-backend` adapter is selected.

#### Scenario: Prebuilt export carries matching provenance

- **GIVEN** `prebuilt-backend` is selected and its server export includes a
  full stamp equal to the build argument
- **WHEN** `merged-backend` validates the selected server
- **THEN** the existing prebuilt adapter remains usable without compiling
  `backend-builder`
- **AND** route merging proceeds with the stamped server tree

### Requirement: Reject prebuilt exports without a full matching stamp

A prebuilt export without a full stamp matching the build argument SHALL fail closed; the build SHALL NOT synthesize a stamp or accept an unstamped export.

#### Scenario: Unstamped or mismatched prebuilt export fails closed

- **GIVEN** the prebuilt export has no stamp, a malformed stamp, or a stamp
  that differs from the full build argument
- **WHEN** `merged-backend` validates the selected server
- **THEN** the Docker build fails before final runtime image creation
- **AND** no fallback stamp or unstamped compatibility path is used

### Requirement: Verify final overlay provenance in an isolated container before startup

Before candidate startup, the image verifier SHALL read the final overlay stamp in a one-shot Linux ARM64 candidate container with networking disabled, a read-only root filesystem, dropped capabilities, `no-new-privileges`, and bounded CPU, memory, and process count. The stamp SHALL equal both the expected full source SHA and the image's OCI revision label. A missing, malformed, or mismatched stamp SHALL stop verification before candidate application startup and publication.

#### Scenario: Final image stamp matches OCI revision

- **GIVEN** the candidate image has OCI revision label `R`
- **WHEN** the verifier reads the final overlay stamp in its bounded
  one-shot container
- **THEN** the stamp must be a full SHA equal to `R` and the expected source
  SHA
- **AND** verification stops before app startup when the file is missing or
  differs
