## MODIFIED Requirements

### Requirement: Pull and deploy the verified main image on the server without building source

The production Compose configuration SHALL consume the fork's published
ARM64 image without building source on the server. After the existing sole
image workflow verifies and publishes a main candidate by immutable digest
and successfully updates main, that workflow SHALL automatically dispatch
production deployment when its source ref is exact canonical main. The
deployment SHALL use only the successful publisher's digest output, source
SHA, workflow run ID, and run attempt; main SHALL NOT identify the image
that Compose starts.

The runner SHALL check that the source SHA still equals canonical main
immediately before SSH. The host SHALL check canonical main again after
pulling the digest and acquiring its lock, immediately before stopping the
app. A stale source SHALL be recorded as SKIPPED_STALE and SHALL cause no
app or DB mutation. The production GitHub Environment SHALL accept main only
and SHALL NOT require a reviewer pause. The job SHALL use a pinned SSH host
key, dedicated forced-command account, fixed root-owned helper, and exact
validated request protocol defined by main-image-ssh-cd.

The host SHALL copy the currently effective production base, candidate,
browser, and image-only Compose inputs into durable root-owned files under
/etc/omniroute-deploy/compose/ and verify that they render the current
production project. These copies SHALL become authoritative for deploy and
rollback; dated diagnostics paths SHALL NOT be runtime dependencies. The host
SHALL verify ARM64/provenance labels and the current app/Redis state, and
change only the app service. It SHALL pull and run the exact digest with
no-build, no-deps, and pull-never behavior; Redis SHALL remain unchanged.
Before candidate startup, it SHALL stop the app, create and validate a fresh
root-only SQLite online backup, record the exact previous image/config and DB
metadata, then allow normal candidate startup migrations to run.

Acceptance SHALL require configured Docker health, direct UI root and public
dashboard HTTP 200, unauthenticated GET /api/v1/models HTTP 401 with AUTH_002,
SQLite integrity, no foreign-key failures, exact numeric migration
source-ID coverage, and unchanged Redis identity. On any post-migration
failure, the host SHALL preserve a candidate DB diagnostic copy and restore
the fresh pre-deploy SQLite snapshot. Before the prior image starts, the
restored DB file SHA-256 SHALL equal the protected backup file's SHA-256
recorded in the transaction manifest. This SHALL compare with the online
backup file, not the pre-backup live DB file, whose bytes may differ despite
equivalent logical contents. The host SHALL then restore the exact prior
image and verify old health and DB state. A failed restore SHALL leave the
app stopped and retain all recovery files. Because the host has no confirmed maintenance proxy,
requests accepted after candidate startup MAY be lost if that snapshot is
restored after a later acceptance failure.

The host transaction SHALL survive runner/SSH disconnect. A nonblocking
server lock and a static non-canceling deployment concurrency group SHALL
prevent overlapping production replacements. The runner and host SHALL
record transaction status by run ID plus attempt; same-tuple retries
reattach, while a GitHub rerun uses a new attempt. Focused checks and a
root-admin isolated Compose/DB rehearsal SHALL precede the first production
run. The workflow SHALL add no general automatic test gate.

#### Scenario: Current-main publication deploys automatically

- **GIVEN** the verified publisher succeeds on canonical main and updates
  main
- **AND** runner and host freshness checks match the source SHA
- **WHEN** the publisher completes
- **THEN** production receives the exact published image digest
- **AND** the host runs only the app service without a build or Redis restart
- **AND** successful migrations and acceptance produce SUCCEEDED

#### Scenario: Publication, freshness, or host preflight fails

- **GIVEN** publication is unsuccessful, main was not updated, the source is
  stale, SSH is invalid, image identity mismatches, or fixed Compose
  preflight fails
- **WHEN** the deploy workflow or host evaluates the request
- **THEN** it records skip/failure before app/DB mutation
- **AND** the currently running app and database remain unchanged

#### Scenario: Candidate migrations or acceptance fail

- **GIVEN** the app has been quiesced and a fresh valid backup exists
- **AND** candidate_may_mutate is true
- **WHEN** candidate startup or any acceptance check fails
- **THEN** the host restores the exact pre-deploy database and prior image
- **AND** it verifies the restored app before returning terminal failure
- **AND** it retains the original backup and failed-candidate diagnostic copy

#### Scenario: Runner disconnects or a rerun arrives

- **GIVEN** a durable transaction is running or has reached a terminal state
- **WHEN** SSH disconnects or the same tuple is retried
- **THEN** the server transaction continues and the retry reattaches to status
- **WHEN** GitHub starts a new run attempt for the same run ID
- **THEN** it receives a distinct transaction key and cannot overlap the
  current server transaction
