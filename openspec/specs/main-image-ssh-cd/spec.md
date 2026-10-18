# main-image-ssh-cd Specification

## Purpose

Automatically deploy each verified current-main image over restricted SSH,
then accept it only after health and database checks or restore the prior
image and database snapshot.

## Requirements

### Requirement: Automatically deploy a verified current-main image

Production deployment SHALL follow successful verified canonical-main publication and use the publisher’s immutable digest plus separately validated source SHA and run tuple.

#### Scenario: Only successful main publication dispatches deploy

- **GIVEN** The publisher has not successfully updated the main tag
- **WHEN** The deploy job evaluates its gate
- **THEN** No production deployment is dispatched

### Requirement: Restrict production SSH to one validated deployment request

Production SSH SHALL use pinned host trust and a single validated deploy record, routed through a dedicated unprivileged forced-command account to a fixed root-owned launcher.

#### Scenario: Malformed record is rejected

- **GIVEN** The SSH record contains an extra field
- **WHEN** The gate validates it
- **THEN** No launcher is invoked

### Requirement: Preserve Compose state and run only the digest-pinned app

Deployment SHALL use durable protected Compose inputs, mutate only the app service to the passed digest, and preserve Redis identity and resolved production configuration.

#### Scenario: Redis is unchanged during app cutover

- **GIVEN** A candidate app digest is deployed
- **WHEN** The transaction completes
- **THEN** Redis container and image identities remain unchanged

### Requirement: Snapshot SQLite before automatic startup migrations

Before normal candidate startup can migrate data, the host SHALL quiesce app writers, create and validate a protected online backup, and persist exact prior state.

#### Scenario: Snapshot precedes startup migration

- **GIVEN** Candidate startup may run migrations
- **WHEN** The transaction prepares cutover
- **THEN** A validated protected snapshot and rollback state already exist

### Requirement: Accept the migrated candidate or automatically restore DB and image

The host SHALL accept only after bounded health, route, database, and Redis probes; on failure it SHALL restore and verify the exact backup bytes and prior image or leave the app stopped with recovery files.

#### Scenario: Failed acceptance restores the prior release

- **GIVEN** A post-migration acceptance probe fails
- **WHEN** Rollback runs
- **THEN** The protected DB snapshot and exact prior image are restored and verified

### Requirement: Dispatch only after successful verified main publication

The repository SHALL keep `.github/workflows/omni-overlay-image.yml` as the sole automatic image workflow and deploy production only after its verified ARM64 candidate is published by immutable digest and the publisher confirms the main-tag update succeeded.

#### Scenario: Verified current main publishes and deploys

- **GIVEN** the canonical main publisher has verified and published an ARM64
  image by full source SHA and manifest digest
- **AND** the main tag update succeeded
- **AND** current canonical main still equals github.sha
- **WHEN** the publisher job completes successfully
- **THEN** the production deploy job receives the exact digest, source SHA,
  run ID, and run attempt
- **AND** it sends only the fixed remote command and validated record
- **AND** the host constructs only the fixed repository plus that digest

#### Scenario: Publication did not produce a current main image

- **GIVEN** publication failed, the main tag update is false, the source ref
  is not exact main, or the repository gate does not match
- **WHEN** GitHub evaluates the deploy job
- **THEN** the job is skipped before entering the production Environment
- **AND** no production secret is available to the publisher
- **AND** no SSH call is made

### Requirement: Require canonical main publisher outputs and immutable digest identity

The deploy job SHALL require canonical repository, exact `refs/heads/main`, successful publisher result, published digest, and `main_tag_updated == true`. Source SHA, run ID, and attempt SHALL be separately validated. Image digest SHALL be the only deployment identity; no mutable tag SHALL select the image.

#### Scenario: Publisher digest is only deployment identity

- **GIVEN** publisher outputs contain a verified digest and current main tag
- **WHEN** the deploy job selects the image
- **THEN** it uses only the digest and retains source SHA, run ID, and attempt separately

### Requirement: Scope production credentials to the protected deploy step

The job SHALL use production Environment accepting only main with no reviewer pause. Only deploy SSH step SHALL receive private key and pinned host key. It SHALL have contents-read permission, check out exactly `github.sha`, and disable persisted checkout credentials. Publisher SHALL NOT receive production SSH credentials.

#### Scenario: Publisher and deploy credentials remain separate

- **GIVEN** publisher and production deploy jobs run in one workflow
- **WHEN** workflow credentials are assigned
- **THEN** only deploy SSH receives production key material

### Requirement: Validate digest, source SHA, and run tuple before SSH

Before SSH, the runner SHALL validate digest as `sha256:` plus 64 lowercase hex digits, source SHA as 40 lowercase hex digits, run ID as bounded positive decimal up to 20 digits, and attempt as bounded positive decimal up to 10 digits. Numeric fields SHALL be treated as strings.

#### Scenario: Request values are malformed

- **GIVEN** any digest, SHA, run ID, or attempt fails its exact bound format
- **OR** a value contains whitespace, a newline, quote, shell substitution,
  backtick, or command separator
- **WHEN** the runner validates the request
- **THEN** it exits before key-file creation and SSH
- **AND** no dynamic value reaches a shell command or remote command string

### Requirement: Reject stale source before transport or temporary key creation

Immediately before transport, the runner SHALL require canonical current-main SHA to equal requested source SHA and `github.sha`. On mismatch it SHALL record `SKIPPED_STALE <run-id>-<attempt>` and make no SSH call or temporary private-key file.

#### Scenario: Main advances before transport

- **GIVEN** canonical main moves after publication
- **WHEN** the runner performs its immediate pre-SSH check
- **THEN** it records SKIPPED_STALE <run-id>-<attempt>
- **AND** it does not materialize the private key or open SSH

### Requirement: Use strict pinned SSH and send one literal deployment record

The runner SHALL use strict pinned host-key checking, batch mode, identity only, no TTY, no agent or port forwarding, bounded connection/keepalive/wait settings, and no runtime key scan or trust-on-first-use. It SHALL send literal `deploy-main` and one LF-terminated four-field record: digest, source SHA, run ID, attempt.

#### Scenario: SSH host key is wrong

- **GIVEN** the server presents an unknown or changed host key
- **WHEN** the deploy runner opens SSH
- **THEN** SSH fails closed before remote command execution
- **AND** it performs no key scan or trust-on-first-use fallback

### Requirement: Remove temporary keys and prevent sensitive transport output

The runner SHALL remove the temporary key on every exit and SHALL NOT log credentials, secret environment, unbounded remote output, response bodies, or database contents.

#### Scenario: Temporary key is removed after SSH failure

- **GIVEN** a temporary private key exists and pinned host verification fails
- **WHEN** the SSH step exits
- **THEN** the key is removed and credentials and response bodies are not logged

### Requirement: Use a dedicated unprivileged SSH account without general host access

The host SHALL use a dedicated deploy account and one restricted SSH key forcing a root-owned gate. The key SHALL disable TTY, agent/X11/port forwarding, user rc, and tunnels. The account SHALL have no shell, Docker, production data, or backup access.

#### Scenario: Restricted command reaches the fixed launcher

- **GIVEN** the key's forced command receives exact deploy-main and one
  valid four-field line
- **WHEN** the gate validates the request
- **THEN** it invokes only the fixed root-owned no-argument launcher
- **AND** the launcher revalidates the request before starting the unit

### Requirement: Validate the SSH record and invoke only a fixed root-owned launcher

The gate SHALL accept only literal `SSH_ORIGINAL_COMMAND=deploy-main` and one LF-terminated tuple of digest, SHA, bounded positive run ID, and attempt. It SHALL reject extra fields/lines/bytes and malformed input before invoking a root-owned launcher via exact no-argument sudo. The launcher SHALL revalidate the tuple and build the image reference from fixed repository plus digest; callers SHALL supply no shell fragments, image, Compose/config arguments, environment, DB, or helper paths.

#### Scenario: Invalid SSH request is rejected

- **GIVEN** an alternate original command, malformed tuple, extra field,
  extra line, or trailing byte
- **WHEN** the forced-command gate receives it
- **THEN** it exits with a bounded error
- **AND** it invokes no sudo, systemd, Docker, Compose, or database command

### Requirement: Load only fixed production config and keep fixtures outside SSH selection

Production SSH SHALL load only fixed root-owned config. A separate root-admin-only fixture CLI MAY select explicit root-owned mode-0600 config after verifying isolated Compose project, ports, volumes, and cloned DB under fixture root. SSH requests SHALL never select or override the fixture profile.

#### Scenario: SSH cannot select the fixture profile

- **GIVEN** a root-admin fixture config exists beside production config
- **WHEN** the validated SSH request loads config
- **THEN** it can load only fixed production config

### Requirement: Verify image provenance and current main before stopping the app

The host SHALL pull and inspect the requested digest, require ARM64 and matching canonical source, source revision, and pinned-base OCI labels, then acquire a nonblocking host lock. Immediately before stopping the app, it SHALL query the fixed public canonical GitHub main-ref API and require its SHA to equal the requested source SHA. A mismatch SHALL persist `SKIPPED_STALE <run-id>-<attempt>` and exit without changing the app, Compose, or database. API failure SHALL fail before mutation.

#### Scenario: Host sees a stale source

- **GIVEN** the request source SHA differs from current canonical main when
  the host performs its final pre-stop check
- **WHEN** the durable transaction evaluates freshness
- **THEN** it records terminal SKIPPED_STALE <run-id>-<attempt>
- **AND** it makes no app, Compose, or database mutation

### Requirement: Run each deployment transaction durably and reattach matching retries

The launcher SHALL run deployment as a durable systemd unit surviving SSH and runner disconnect. It SHALL persist RUNNING, SUCCEEDED, SKIPPED_STALE, or FAILED by `<run-id>-<attempt>` and return bounded status. Repeating the same four-field tuple SHALL reattach to its in-progress or terminal result without another deploy.

#### Scenario: SSH disconnects after transaction launch

- **GIVEN** the host has started the systemd transaction
- **WHEN** SSH or the Actions runner disconnects
- **THEN** the transaction retains its lock and continues through success or
  rollback
- **AND** the same tuple can reconnect to its status

### Requirement: Serialize deploy attempts and reject transaction-key collisions

Reusing one transaction key with different fields SHALL fail closed; a GitHub rerun with a new attempt SHALL create a separate transaction. The workflow SHALL have no workflow-wide concurrency group. Publisher canceling concurrency SHALL be scoped to image publication; deploy SHALL use a static non-canceling group, and the host SHALL independently serialize with a nonblocking lock.

#### Scenario: Concurrent or duplicate invocation arrives

- **GIVEN** an identical tuple is already running or terminal
- **WHEN** the gate receives that same tuple again
- **THEN** it returns or waits on the existing result without a second deploy
- **GIVEN** a different transaction already holds the host lock
- **WHEN** another distinct tuple reaches the server
- **THEN** it records failure before Compose or DB mutation

### Requirement: Copy effective Compose inputs into durable root-owned deployment files

The host SHALL copy current production base, candidate, browser, and image-only Compose inputs under `/etc/omniroute-deploy/compose/` and verify they render the running project with the same services, ports, environment, mounts, init, restart policy, networks, and app/Redis image identities.

#### Scenario: Candidate is accepted by the host

- **GIVEN** the digest is published, current, ARM64, and carries matching
  source, revision, and base labels
- **AND** fixed Compose validation succeeds
- **WHEN** the server starts the candidate
- **THEN** only omniroute changes to the exact digest
- **AND** the server performs no build or dependency restart
- **AND** Redis container/image identity stays unchanged
- **AND** the persistent image override changes only after acceptance

### Requirement: Use protected Compose inputs for deploy and rollback

These durable copies SHALL be authoritative for deploy and rollback; dated diagnostics or temporary snapshots SHALL NOT be runtime dependencies. Before app stop, the host SHALL render and validate root-owned project and confirm Redis identity.

#### Scenario: Dated diagnostics are not runtime dependencies

- **GIVEN** protected Compose inputs render the current production project
- **WHEN** the host prepares deployment
- **THEN** it uses root-owned inputs without dated diagnostics or temporary snapshots

### Requirement: Compare both running services with resolved effective configuration

Preflight SHALL compare both running services with resolved effective config in memory, including identity, image reference/ID, environment, command/entrypoint, user/workdir, init/restart/health, ports, mounts, networks, and user labels.

#### Scenario: Runtime projection checks every supported field

- **GIVEN** app and Redis run with known effective configuration
- **WHEN** preflight compares runtime state
- **THEN** it checks each supported identity and configuration field

### Requirement: Resolve defaults and omit generated Compose labels without hiding drift

Preflight SHALL resolve inherited image defaults and omit generated `com.docker.compose.*` labels, including historical paths and version/hash, from label equality while enforcing project/service identity and protected paths separately. It SHALL reject unsupported or missing fields, SHALL NOT print or persist environment values, and historical hash metadata SHALL NOT require dependency restart.

#### Scenario: Historical Compose metadata differs but runtime is unchanged

- **GIVEN** running app/Redis effective fields equal the resolved fixed project
- **AND** historical hash labels differ because of Compose metadata generation
- **WHEN** the app-only baseline dry-run reports only the existing app Running
- **THEN** preflight succeeds without restarting Redis or adding version-specific logic

### Requirement: Run only the requested app digest and preserve Redis identity

The host SHALL pull the exact repository digest, SHALL NOT build source, and SHALL change only the app service. Every app start SHALL use no-build, no-deps, and pull-never behavior. Redis SHALL remain running with container/image identity unchanged.

#### Scenario: Compose or image preflight fails

- **GIVEN** Compose inputs differ from the root-owned config, image labels
  mismatch, architecture is not ARM64, or Redis would be changed
- **WHEN** the server validates the transaction
- **THEN** it fails before stopping the current app or changing its database

### Requirement: Reject unexpected plans in a no-mutation app-only dry run

The fixed app-only dry run SHALL use no-deps, no-build, and pull-never and report only existing app Running with no mutation. Empty, unknown, dependency, create/recreate/start/stop/pull/build plans SHALL fail before app stop. After normalizing only candidate app image to baseline, candidate rendering SHALL equal baseline. Redis identity and health SHALL be checked before cutover, during acceptance, before commit, and after rollback.

#### Scenario: Effective configuration or dry-run plan changes

- **GIVEN** an effective runtime field differs, the candidate changes more than
  its app image, or the baseline dry-run contains an unexpected action
- **WHEN** preflight validates the fixed project
- **THEN** it fails before stopping the app or modifying the database

### Requirement: Record the actual prior image and pin candidate startup to passed digest

Before candidate startup, the host SHALL record the actual prior app image, persistent image-only override, and filesystem metadata needed for exact restore. Candidate startup SHALL use a root-owned temporary override that pins the passed digest. After acceptance, the host SHALL atomically persist that digest as the stable image-only override. On failure, it SHALL restore the previous override and prior image.

#### Scenario: Candidate app uses only the passed digest

- **GIVEN** the request contains a validated immutable digest and the current app has a different image
- **WHEN** the host starts the candidate app
- **THEN** the temporary override pins the requested digest and the stable prior override remains available for restore

### Requirement: Quiesce SQLite and create a protected online backup before migrations

Before migration code can run, the host SHALL stop the current app to quiesce writers and create a fresh SQLite online backup. It SHALL use a root-owned mode-0700 diagnostics directory, umask 077, mode 0600, source/run/attempt manifest, and SHA-256 digest.

#### Scenario: Fresh protected snapshot passes

- **GIVEN** the app service is stopped and all other fixed Compose inputs
  validate
- **WHEN** the host creates and checks the new SQLite online backup
- **THEN** it stores a mode-0600 hashed snapshot and rollback manifest
- **AND** it may persist candidate_may_mutate and start the candidate

### Requirement: Validate the online backup before candidate startup

The app-native SQLite checker SHALL return exactly `ok` from `integrity_check` and no rows from `foreign_key_check`. Failure SHALL block candidate startup and restart the prior app against untouched DB.

#### Scenario: Snapshot fails before migration

- **GIVEN** backup creation, hashing, native integrity, or foreign-key check
  fails
- **WHEN** the transaction reaches the snapshot gate
- **THEN** no candidate migration runs
- **AND** the prior image restarts against the unchanged database
- **AND** the transaction records FAILED

### Requirement: Persist rollback state before normal candidate startup migrations

The host SHALL preserve original backup through the transaction. After verification it SHALL persist prior image/override, DB owner/group/mode, and `candidate_may_mutate=true` before Compose starts. Candidate migrations SHALL run through normal app startup; no separate migration command or reverse migration SHALL run.

#### Scenario: Migration boundary is durable before startup

- **GIVEN** protected snapshot and prior release metadata are verified
- **WHEN** Compose starts the candidate
- **THEN** candidate_may_mutate and prior restore state were persisted first

### Requirement: Reject pre-existing SQLite sidecars before standalone validation

Standalone backup/restored-file validation SHALL reject pre-existing WAL/SHM/journal companions, including dangling symlinks. It SHALL record main-file SHA-256 and owner/group/mode, mount parent writable only for native validator, and run read-only SQL as file numeric UID/GID.

#### Scenario: Standalone WAL-mode snapshot needs temporary sidecars

- **GIVEN** the app is stopped and a standalone snapshot has no companions
- **WHEN** native read-only SQL creates temporary WAL/SHM in its writable parent
- **THEN** checks run as the main file's numeric owner/group
- **AND** only those newly created regular matching-owner companions are removed
- **AND** main-file bytes and ownership/mode remain unchanged

#### Scenario: Snapshot companion already exists

- **GIVEN** a WAL/SHM/journal path exists, including a dangling symlink
- **WHEN** standalone snapshot validation begins
- **THEN** validation fails before the native process starts
- **AND** no existing companion is deleted or followed

### Requirement: Remove only validator-created sidecars and verify the main file is unchanged

Standalone validation SHALL remove only newly created regular companions with matching owner/group, without following symlinks, and verify main-file hash and metadata remain unchanged. Cleanup or invariant failure SHALL reject the check.

#### Scenario: Validator cleans only sidecars it created

- **GIVEN** native validation created regular WAL sidecars with matching owner and group
- **WHEN** cleanup runs
- **THEN** it removes only those companions and main-file bytes and metadata stay unchanged

### Requirement: Validate live DB with exact owner and shared read-only WAL state

Live DB validation SHALL require a regular actual main DB via `lstat` and run as exact numeric UID/GID without fallback. It SHALL retain a read-only complete directory mount, read-only SQL, and shared real WAL/SHM. It SHALL not clean live sidecars or require a stable main hash during writes. No immutable-mode bypass or existing-sidecar deletion SHALL be introduced.

#### Scenario: Live DB belongs to the application user

- **GIVEN** the app owns the main DB and WAL/SHM with mode0660
- **AND** the native validator drops all Linux capabilities
- **WHEN** live integrity/FK/migration checks run
- **THEN** the validator uses the main file's exact numeric UID/GID
- **AND** the whole data directory and SQL connection remain read-only
- **AND** actual shared WAL/SHM are preserved without copies or cleanup

### Requirement: Match applied numeric migration versions to the SQL source set

After candidate startup, the host SHALL compare sorted numeric SQL migration IDs under `/app/migrations` with numeric versions in `_omniroute_migrations`. The sets SHALL match exactly; existing nonnumeric legacy ledger rows SHALL be preserved and excluded from numeric comparison.

#### Scenario: Migration ledger contains exactly the SQL source IDs

- **GIVEN** candidate startup completed with the SQL migration directory and migration ledger available
- **WHEN** the host checks migration coverage
- **THEN** sorted numeric IDs match exactly and nonnumeric legacy ledger rows remain untouched

### Requirement: Accept candidate only after bounded health, route, SQLite, and Redis probes

Acceptance SHALL require healthy Docker status, direct UI root and public dashboard HTTP 200, unauthenticated `GET /api/v1/models` HTTP 401 with `AUTH_002`, native SQLite integrity and foreign-key checks, exact migration-source coverage, and unchanged Redis identity. Each check SHALL have a finite bound from health timing, startup allowance, and route checks.

#### Scenario: Migrated candidate passes acceptance

- **GIVEN** the candidate health, UI, API auth, SQLite, migration-ID, and
  Redis checks all pass
- **WHEN** the acceptance transaction completes
- **THEN** the stable image override records the exact candidate digest
- **AND** status is SUCCEEDED <run-id>-<attempt>
- **AND** the protected pre-deploy backup remains available

### Requirement: Run private probes in the app and public dashboard probe on the host

Private UI/API checks SHALL execute through app-container Node against loopback port 20128 for candidate and prior image and emit only sanitized status/error codes. Public dashboard check SHALL run from host. Production gateway binding on port 20129 SHALL remain unchanged.

#### Scenario: Private and public probes use their assigned contexts

- **GIVEN** candidate and prior images are under acceptance and public dashboard is reachable
- **WHEN** the checks run
- **THEN** private UI/API checks use app-container loopback while public dashboard runs from host

### Requirement: Keep the failing dashboard fixture isolated on its fixed loopback proxy

The fixture SHALL use the private probe context and a root-controlled temporary host-loopback proxy for only `http://127.0.0.1:<explicit-port>/dashboard/radar`. The proxy SHALL forward that fixed path to the fixture app isolated gateway on port 20129 and relay actual HTTP status.

#### Scenario: Deliberately failing dashboard proof stays fixture-local

- **GIVEN** the fixture uses a loopback dashboard URL and private fixture gateway
- **WHEN** the dashboard acceptance probe runs
- **THEN** the fixed proxy relays the fixture app status without publishing fixture ports or changing production settings

### Requirement: Keep fixture network private and preserve production configuration

Fixture networks SHALL be internal/nonexternal with no host ports. The profile SHALL reject URL credentials, query, fragment, missing/invalid port, and nonliteral loopback. The proxy SHALL mask request/body logs and stop after proof while protected DB artifacts remain. Production networks, firewall, ports, and URL acceptance SHALL remain unchanged.

#### Scenario: Fixture URLs cannot affect production

- **GIVEN** fixture uses invalid destinations and protected database artifacts
- **WHEN** the proof finishes
- **THEN** invalid URLs are rejected and production network and URL settings stay unchanged

### Requirement: Persist accepted candidate digest only after acceptance passes

On acceptance, the host SHALL atomically persist candidate digest in image-only override and record `SUCCEEDED <run-id>-<attempt>`. It SHALL keep fresh pre-deploy backup protected.

#### Scenario: Accepted candidate digest is committed

- **GIVEN** all acceptance probes pass for an immutable candidate digest
- **WHEN** the transaction commits
- **THEN** the stable override and SUCCEEDED status record that digest and the pre-deploy backup remains protected

### Requirement: Restore the protected snapshot and prior image after candidate failure

After `candidate_may_mutate` becomes true, any migration, startup, health, route, SQLite, ledger, or Compose-persistence failure SHALL trigger rollback. The host SHALL stop candidate, create protected DB diagnostic copy if it exists, remove candidate WAL/SHM, atomically restore snapshot and recorded owner/group/mode, then restore prior image override.

#### Scenario: Post-migration acceptance fails

- **GIVEN** candidate_may_mutate is true and any acceptance check fails
- **WHEN** the transaction enters rollback
- **THEN** it saves a root-only diagnostic copy of candidate DB state
- **AND** removes candidate WAL/SHM and restores the fresh pre-deploy DB
- **AND** verifies restored DB-file SHA-256 equals protected backup-file
  SHA-256 before starting the prior image
- **AND** restores the prior image and stable override
- **AND** verifies old health, routes, and DB before recording FAILED

### Requirement: Verify restored DB bytes and prior release before rollback completes

Before prior app startup, restored DB SHA-256 SHALL equal protected online-backup file hash byte-for-byte, not the pre-backup live DB hash. Before rollback completes, native integrity, foreign-key, prior-image migration-ledger, Docker health, UI, and API-auth probes SHALL pass.

#### Scenario: Rollback verifies exact snapshot bytes before prior startup

- **GIVEN** candidate acceptance failed and online backup hash is recorded
- **WHEN** the prior app is about to restart
- **THEN** restored DB bytes match the protected online backup and prior release probes pass

### Requirement: Leave app stopped and preserve recovery files if rollback cannot be verified

If restore or prior-image verification fails, the host SHALL leave app stopped, preserve all recovery files and original backup, and record FAILED with bounded reason. It SHALL never start against unverified DB or delete the backup. With no confirmed maintenance gate, writes accepted after candidate startup MAY be lost when restoring the pre-deploy snapshot.

#### Scenario: Database or prior-image restore fails

- **GIVEN** restoration or prior-image acceptance cannot be verified
- **WHEN** automatic rollback finishes
- **THEN** the app remains stopped
- **AND** all backups and diagnostic files remain protected
- **AND** status records FAILED with a bounded rollback-failure reason
