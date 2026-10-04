## ADDED Requirements

### Requirement: Automatically deploy a verified current-main image

The repository SHALL keep .github/workflows/omni-overlay-image.yml as the
sole automatic image workflow and SHALL deploy production from that workflow
only after its verified ARM64 candidate is published by immutable digest and
the publisher confirms that the main tag update succeeded. The deploy job
SHALL require the canonical repository, exact refs/heads/main, successful
publisher result, published digest, and main_tag_updated == true. It SHALL
use the source commit SHA, workflow run ID, and workflow run attempt as
separate validated values. The image digest SHALL be the only deployment
identity; no mutable tag SHALL select the deployed image.

The job SHALL use a GitHub Environment named production that accepts only
main and requires no reviewer pause. Only the deploy job's SSH step SHALL
receive the private key and pinned host-key material. The job SHALL have
contents-read permission, check out exactly github.sha, and disable
persisted checkout credentials. The publisher SHALL NOT receive production
SSH credentials.

Before SSH, the runner SHALL validate the digest as sha256: followed by 64
lowercase hexadecimal digits, source SHA as 40 lowercase hexadecimal digits,
run ID as bounded positive decimal up to 20 digits, and run attempt as
bounded positive decimal up to 10 digits. It SHALL treat numeric fields as
strings. Immediately before transport, it SHALL require the canonical
current-main SHA to equal both requested source SHA and github.sha. On
mismatch it SHALL record SKIPPED_STALE <run-id>-<attempt> and make no SSH
call or temporary private-key file.

The runner SHALL use strict pinned host-key checking, batch mode, identity
only, no TTY, no agent or port forwarding, bounded connect/keepalive/wait
settings, and no runtime key scan or trust-on-first-use. It SHALL send one
literal remote command, deploy-main, and exactly one LF-terminated
four-field stdin record: digest, source SHA, run ID, and attempt. It SHALL
remove the temporary key on every exit and SHALL NOT log credentials,
secret environment, unbounded remote output, response bodies, or database
contents.

The workflow SHALL have no workflow-wide concurrency group. The publisher
job SHALL keep canceling concurrency scoped to image publication. The deploy
job SHALL use one static non-canceling concurrency group so a newer main push
cannot cancel a running server transaction. The server SHALL independently
serialize transactions with a nonblocking lock.

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

#### Scenario: Main advances before transport

- **GIVEN** canonical main moves after publication
- **WHEN** the runner performs its immediate pre-SSH check
- **THEN** it records SKIPPED_STALE <run-id>-<attempt>
- **AND** it does not materialize the private key or open SSH

#### Scenario: Request values are malformed

- **GIVEN** any digest, SHA, run ID, or attempt fails its exact bound format
- **OR** a value contains whitespace, a newline, quote, shell substitution,
  backtick, or command separator
- **WHEN** the runner validates the request
- **THEN** it exits before key-file creation and SSH
- **AND** no dynamic value reaches a shell command or remote command string

#### Scenario: SSH host key is wrong

- **GIVEN** the server presents an unknown or changed host key
- **WHEN** the deploy runner opens SSH
- **THEN** SSH fails closed before remote command execution
- **AND** it performs no key scan or trust-on-first-use fallback

### Requirement: Restrict production SSH to one validated deployment request

The production host SHALL use a dedicated unprivileged deploy account and a
single restricted SSH key. The key SHALL force a root-owned gate and SHALL
disable TTY, agent forwarding, X11 forwarding, port forwarding, user rc, and
tunnels. The account SHALL have no general shell, Docker access, production
data access, or backup access. The gate SHALL accept only literal
SSH_ORIGINAL_COMMAND=deploy-main and exactly one LF-terminated record with
four validated fields: digest, source SHA, bounded positive run ID, bounded
positive attempt. It SHALL reject extra fields, lines, bytes, wrong command,
or malformed fields before invoking the root launcher.

The gate SHALL invoke only a root-owned fixed launcher through an exact
no-argument sudo rule. The launcher SHALL revalidate the entire record and
construct the repository image reference from the fixed repository name and
validated digest. It SHALL accept no shell fragments, image ref, Compose
arguments, config paths, environment selection, DB path, or helper path from
the request.

The host SHALL pull and inspect the requested digest, require ARM64 and
matching canonical source, source revision, and pinned-base OCI labels, then
acquire a nonblocking host lock. Immediately before stopping the app, it
SHALL query the fixed public canonical GitHub main-ref API and require its
SHA to equal the requested source SHA. A mismatch SHALL persist
SKIPPED_STALE <run-id>-<attempt> and exit without changing the app,
Compose, or database. API failure SHALL fail before mutation.

The root-owned launcher SHALL run the deployment transaction as a durable
systemd unit that survives SSH and runner disconnect. It SHALL persist
RUNNING, SUCCEEDED, SKIPPED_STALE, or FAILED for each <run-id>-<attempt> and
return bounded status output. Repeating the same four-field tuple SHALL
reattach to its in-progress or terminal result without starting another
deploy. Reusing the same transaction key with different fields SHALL fail
closed. A GitHub rerun with a new attempt SHALL create a separate transaction.

Production SSH SHALL load only a fixed root-owned production config. A
separate root-admin-only fixture CLI MAY select an explicit root-owned
mode-0600 fixture config after verifying that its Compose project, ports,
volumes, and cloned DB are isolated under the fixture root. The SSH request
SHALL never select or override this fixture profile.

#### Scenario: Restricted command reaches the fixed launcher

- **GIVEN** the key's forced command receives exact deploy-main and one
  valid four-field line
- **WHEN** the gate validates the request
- **THEN** it invokes only the fixed root-owned no-argument launcher
- **AND** the launcher revalidates the request before starting the unit

#### Scenario: Invalid SSH request is rejected

- **GIVEN** an alternate original command, malformed tuple, extra field,
  extra line, or trailing byte
- **WHEN** the forced-command gate receives it
- **THEN** it exits with a bounded error
- **AND** it invokes no sudo, systemd, Docker, Compose, or database command

#### Scenario: Host sees a stale source

- **GIVEN** the request source SHA differs from current canonical main when
  the host performs its final pre-stop check
- **WHEN** the durable transaction evaluates freshness
- **THEN** it records terminal SKIPPED_STALE <run-id>-<attempt>
- **AND** it makes no app, Compose, or database mutation

#### Scenario: SSH disconnects after transaction launch

- **GIVEN** the host has started the systemd transaction
- **WHEN** SSH or the Actions runner disconnects
- **THEN** the transaction retains its lock and continues through success or
  rollback
- **AND** the same tuple can reconnect to its status

#### Scenario: Concurrent or duplicate invocation arrives

- **GIVEN** an identical tuple is already running or terminal
- **WHEN** the gate receives that same tuple again
- **THEN** it returns or waits on the existing result without a second deploy
- **GIVEN** a different transaction already holds the host lock
- **WHEN** another distinct tuple reaches the server
- **THEN** it records failure before Compose or DB mutation

### Requirement: Preserve Compose state and run only the digest-pinned app

The host SHALL copy the currently effective production base, candidate,
browser, and image-only Compose inputs into durable root-owned files under
/etc/omniroute-deploy/compose/. It SHALL verify that these copies render the
currently running project with the same services, ports, environment,
mounts, init behavior, restart policy, networks, and app/Redis image
identities. These copies SHALL become the authoritative inputs for deploy
and rollback; the host SHALL NOT rely on dated diagnostics or temporary
snapshot paths. Before app stop, it SHALL render and validate the root-owned
project and confirm Redis identity. It SHALL pull the exact repository
digest, SHALL NOT build source, and SHALL change only the omniroute app
service. Every app start SHALL use no-build, no-deps, and pull-never
behavior. Redis SHALL remain running and retain its container/image identity.

Preflight SHALL compare both running services with the resolved effective
configuration in memory, including identities, image reference/ID,
environment, command/entrypoint, user/workdir, init/restart/health, ports,
mounts, networks, and user labels. It SHALL resolve inherited image defaults,
omit generated `com.docker.compose.*` label metadata (including historical
paths and version/hash) from label equality while enforcing project/service
identity and protected input paths separately, reject unsupported or missing
projection fields, and SHALL NOT print or persist environment values.
Historical hash metadata SHALL NOT require a dependency restart.

The fixed project's app-only dry-run SHALL use no-deps, no-build, and
pull-never behavior and SHALL report only the existing app Running with no
mutation. Empty, unknown, dependency, create/recreate/start/stop/pull/build
plans SHALL fail before app stop. After normalizing only the candidate app
image back to the baseline image, the complete candidate rendering SHALL
equal the baseline. Redis identity and health SHALL be checked before
cutover, during acceptance, before commit, and after rollback.

Before candidate startup, the host SHALL record the actual prior app image,
persistent image-only override, and filesystem metadata needed for exact
restore. Candidate startup SHALL use a root-owned temporary override that
pins the passed digest. After acceptance, the host SHALL atomically persist
that digest as the stable image-only override. On failure, it SHALL restore
the previous override and prior image.

#### Scenario: Candidate is accepted by the host

- **GIVEN** the digest is published, current, ARM64, and carries matching
  source, revision, and base labels
- **AND** fixed Compose validation succeeds
- **WHEN** the server starts the candidate
- **THEN** only omniroute changes to the exact digest
- **AND** the server performs no build or dependency restart
- **AND** Redis container/image identity stays unchanged
- **AND** the persistent image override changes only after acceptance

#### Scenario: Compose or image preflight fails

- **GIVEN** Compose inputs differ from the root-owned config, image labels
  mismatch, architecture is not ARM64, or Redis would be changed
- **WHEN** the server validates the transaction
- **THEN** it fails before stopping the current app or changing its database

#### Scenario: Historical Compose metadata differs but runtime is unchanged

- **GIVEN** running app/Redis effective fields equal the resolved fixed project
- **AND** historical hash labels differ because of Compose metadata generation
- **WHEN** the app-only baseline dry-run reports only the existing app Running
- **THEN** preflight succeeds without restarting Redis or adding version-specific logic

#### Scenario: Effective configuration or dry-run plan changes

- **GIVEN** an effective runtime field differs, the candidate changes more than
  its app image, or the baseline dry-run contains an unexpected action
- **WHEN** preflight validates the fixed project
- **THEN** it fails before stopping the app or modifying the database

### Requirement: Snapshot SQLite before automatic startup migrations

Before any candidate can run migration code, the host SHALL stop the current
app service to quiesce writers and create a new SQLite online backup from the
live production DB. The backup SHALL be created under a root-owned mode-0700
diagnostics directory with umask 077, mode 0600, a source/run/attempt
manifest, and a SHA-256 digest. It SHALL be checked with the app's native
SQLite implementation; integrity_check SHALL return exactly ok and
foreign_key_check SHALL return no rows. Failure to create or validate the
backup SHALL prevent candidate startup and restart the prior app against the
untouched DB.

The host SHALL preserve the original backup through the whole transaction.
After the verified snapshot exists, it SHALL persist the prior image,
prior image-only override, DB owner/group/mode, and
candidate_may_mutate=true before any Compose start that can run migrations.
The candidate SHALL apply its migrations through normal app startup; no
separate migration command or reverse migration SHALL run.

After candidate startup, the host SHALL compare sorted numeric SQL migration
IDs under /app/migrations with numeric versions in _omniroute_migrations.
The sets SHALL match exactly; existing nonnumeric legacy ledger rows SHALL
be preserved and excluded from numeric comparison.

For standalone backup/restored-file validation, the host SHALL reject any
pre-existing WAL/SHM/journal companion, including dangling symlinks. It SHALL
record main-file SHA-256 and owner/group/mode, mount the parent writable only
for the native validator, and run read-only SQL as the file's numeric UID/GID.
Finally it SHALL remove only newly created regular companions with matching
owner/group, without following symlinks, and verify the main-file hash and
metadata remain unchanged. Cleanup or invariant failure SHALL reject the
check. Live DB validation SHALL require a regular actual main DB via lstat,
run as its exact numeric UID/GID without fallback, and retain the read-only
complete directory mount, read-only SQL, and shared real WAL/SHM. It SHALL not
clean live sidecars or require a stable main hash during concurrent app
writes. No immutable-mode bypass or existing-sidecar deletion SHALL be
introduced.

#### Scenario: Live DB belongs to the application user

- **GIVEN** the app owns the main DB and WAL/SHM with mode0660
- **AND** the native validator drops all Linux capabilities
- **WHEN** live integrity/FK/migration checks run
- **THEN** the validator uses the main file's exact numeric UID/GID
- **AND** the whole data directory and SQL connection remain read-only
- **AND** actual shared WAL/SHM are preserved without copies or cleanup

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

#### Scenario: Fresh protected snapshot passes

- **GIVEN** the app service is stopped and all other fixed Compose inputs
  validate
- **WHEN** the host creates and checks the new SQLite online backup
- **THEN** it stores a mode-0600 hashed snapshot and rollback manifest
- **AND** it may persist candidate_may_mutate and start the candidate

#### Scenario: Snapshot fails before migration

- **GIVEN** backup creation, hashing, native integrity, or foreign-key check
  fails
- **WHEN** the transaction reaches the snapshot gate
- **THEN** no candidate migration runs
- **AND** the prior image restarts against the unchanged database
- **AND** the transaction records FAILED

### Requirement: Accept the migrated candidate or automatically restore DB and image

The host SHALL accept a candidate only when Docker health is healthy, direct
UI root and public dashboard return HTTP 200, unauthenticated
GET /api/v1/models returns HTTP 401 with AUTH_002, native SQLite integrity
and foreign-key checks pass, migration source-ID coverage is exact, and Redis
identity remains unchanged. Each check SHALL have a finite bound derived from
the image health interval, timeout, retries, start period, image pull/start
allowance, and local route checks.

Private UI/API checks SHALL execute through the app container's Node runtime
against its loopback listener on port 20128, for both candidate and prior
image. They SHALL emit only sanitized HTTP status and error-code results.
The public dashboard check SHALL execute from the host. The existing
production gateway binding on port 20129 SHALL remain unchanged. The fixture
SHALL use the same private probe context and a root-controlled temporary
host-loopback proxy for the deliberately failing public dashboard URL
`http://127.0.0.1:<explicit-port>/dashboard/radar`. The proxy SHALL forward only
that fixed path to the fixture app's isolated gateway on port 20129 and relay
its actual HTTP status. Every fixture container network SHALL remain internal
and nonexternal; fixture services SHALL publish no host ports. The profile
SHALL reject URL credentials, query, fragment, missing/invalid port, and
nonliteral loopback destinations. The proxy SHALL mask request/body logs and
stop after proof while protected database artifacts remain. Production
networks, firewall, ports, and URL acceptance SHALL remain unchanged.

On acceptance, the host SHALL atomically persist the candidate digest in the
image-only override and record SUCCEEDED <run-id>-<attempt>. It SHALL keep
the fresh pre-deploy backup protected.

After candidate_may_mutate becomes true, any migration, startup, health,
route, SQLite, migration-ledger, or Compose-persistence failure SHALL trigger
automatic rollback. The host SHALL stop the candidate, create a protected
SQLite diagnostic copy if candidate DB exists, remove candidate WAL/SHM,
restore the pre-deploy snapshot atomically, restore its recorded owner/group/
mode and the prior image override. Before starting the prior app image, it
SHALL require the restored DB file SHA-256 to equal the protected backup
file's SHA-256 recorded in the transaction manifest, byte-for-byte. This
comparison SHALL use the backup file produced by SQLite's online backup,
not the live DB file hash from before backup creation; those files may differ
in bytes while representing the same logical database. Before marking
rollback complete, it SHALL verify the restored DB with native integrity,
foreign-key, and prior-image migration-ledger checks plus the old image's
Docker health, UI, and API-auth probes.

If restoring the snapshot or verifying the prior image fails, the host SHALL
leave the app stopped, preserve all recovery files, and record FAILED with a
bounded rollback-failure reason. It SHALL never start an app against an
unverified DB or delete the original backup. Since no ingress maintenance
gate is confirmed, writes accepted after candidate startup MAY be lost when
the requested pre-deploy DB snapshot is restored.

#### Scenario: Migrated candidate passes acceptance

- **GIVEN** the candidate health, UI, API auth, SQLite, migration-ID, and
  Redis checks all pass
- **WHEN** the acceptance transaction completes
- **THEN** the stable image override records the exact candidate digest
- **AND** status is SUCCEEDED <run-id>-<attempt>
- **AND** the protected pre-deploy backup remains available

#### Scenario: Post-migration acceptance fails

- **GIVEN** candidate_may_mutate is true and any acceptance check fails
- **WHEN** the transaction enters rollback
- **THEN** it saves a root-only diagnostic copy of candidate DB state
- **AND** removes candidate WAL/SHM and restores the fresh pre-deploy DB
- **AND** verifies restored DB-file SHA-256 equals protected backup-file
  SHA-256 before starting the prior image
- **AND** restores the prior image and stable override
- **AND** verifies old health, routes, and DB before recording FAILED

#### Scenario: Database or prior-image restore fails

- **GIVEN** restoration or prior-image acceptance cannot be verified
- **WHEN** automatic rollback finishes
- **THEN** the app remains stopped
- **AND** all backups and diagnostic files remain protected
- **AND** status records FAILED with a bounded rollback-failure reason
