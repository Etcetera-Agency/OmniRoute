# Design: Main-image production deployment over restricted SSH

<!-- AICODE-NOTE: Only a current-main, digest-pinned image may enter the server transaction. Quiesce SQLite before snapshot; after candidate startup any acceptance failure restores that snapshot and the exact prior image. -->

## Fixed architecture

Extend .github/workflows/omni-overlay-image.yml, the existing sole automatic
image workflow. Its verified main publisher exports the immutable manifest
digest and whether it updated the main tag. A dependent deploy-production job
runs only when publication succeeded, the main tag update is true, and the
source ref is exact main in the canonical repository.

The deploy job uses GitHub Environment production, restricted to main and
without a required-reviewer pause. It checks out exactly github.sha with
persisted credentials disabled and read-only contents permission. The private
key is bound only to the SSH step. Publishing credentials never enter the
server job.

Remove workflow-wide concurrency, which could cancel an in-progress
production transaction when a new main push arrives. Keep canceling
concurrency on the image publisher only. Give the deploy job a static
production group with cancel-in-progress false; a newer run may replace a
pending run, while the active server transaction finishes. The host lock is
the second serialization boundary.

## Runner gate and wire protocol

The transport helper validates all four fields before creating a temporary
key file or invoking SSH:

- Published image digest: sha256: plus 64 lowercase hexadecimal digits.
- Source SHA: exactly 40 lowercase hexadecimal digits and equal to github.sha.
- Workflow run ID: positive decimal, at most 20 digits.
- Workflow run attempt: positive decimal, at most 10 digits.

Treat run ID and attempt as strings; do not parse them as shell arithmetic.
The transaction key is <run-id>-<attempt>. The request is exactly one
LF-terminated line:

    <digest> <source-sha> <run-id> <attempt>

Immediately before transport, the helper calls the repository's current-main
check and requires the returned SHA to equal both source SHA and github.sha.
A mismatch records SKIPPED_STALE <run-id>-<attempt> in the Actions summary
and exits before materializing the key or opening SSH.

SSH sends only literal remote command deploy-main; it interpolates no request
field into that command. After regex validation, it sends the record through
a heredoc. Use strict host-key checking with the pinned ED25519 host key for
130.162.40.87, a dedicated known-hosts file, batch mode, identity-only
authentication, no agent forwarding, no port forwarding, no TTY, and bounded
connection/keepalive settings. Never use ssh-keyscan, TOFU, verbose SSH logs,
or shell tracing. Remove the temporary private key with an exit trap.

The key on the server is installed for one forced command with restrict (or
explicit equivalent restrictions). The rootless gate accepts only
SSH_ORIGINAL_COMMAND=deploy-main and exactly one well-formed request line.
It rejects extra fields, lines, bytes, or malformed values before calling the
fixed no-argument sudo entry point. Both gate and root helper validate again.
The root helper constructs the fixed repository image reference plus the
validated digest; it accepts no image ref, Compose argument, environment
name, or path from the request.

The runner and host both check freshness. After pulling the requested digest
and acquiring the host lock, but immediately before stopping the app, the
host reads the canonical public GitHub main-ref API and requires its SHA to
equal the request source SHA. A mismatch persists SKIPPED_STALE under the
transaction key and exits without changing Compose, app, or database state.
API failure is a pre-mutation FAILED, never permission to proceed.

## Host-owned paths and durable transaction

Provision dedicated unprivileged account omniroute-deploy. Its forced
command is a root-owned gate. Its sole sudo permission is the exact
no-argument /usr/local/sbin/omniroute-deploy entry point. The helper,
transaction program, sudoers file, Compose config, and status files are
root-owned; the SSH account cannot read production data or backup files.

Use /etc/omniroute-deploy/ for fixed production configuration and durable
root-owned copies of the effective base, candidate, browser, and image-only
Compose inputs. Use /opt/apps/omniroute-deploy-diagnostics/ for root-only
backups and per-attempt status, and /run/lock/omniroute-deploy.lock for a
nonblocking exclusive lock. Install the deploy gate at
/usr/local/libexec/omniroute-deploy-gate, transaction program at
/usr/local/libexec/omniroute-deploy-transaction, and fixed launcher at
/usr/local/sbin/omniroute-deploy.

The launcher validates and records the request, then starts or reattaches to
a root systemd oneshot for transaction key <run-id>-<attempt>. The unit owns
the full pull, stop, backup, migration, acceptance, and rollback sequence.
SSH waits for its durable status, but disconnecting or canceling the runner
does not stop the unit. Status is one of RUNNING, SUCCEEDED, SKIPPED_STALE,
or FAILED, with bounded error tags. The same transaction key and same
four-field tuple reattach to current or terminal status; the same key with
different fields fails closed. A rerun's incremented attempt creates a
distinct transaction.

Production always loads the fixed root-owned production config. A separate
root-admin-only CLI may select an explicit fixture config for rehearsal; it
requires a root-owned mode-0600 config, a unique Compose project, cloned
fixture data, internal-only networks, no container-published ports, and all persistent paths under the fixture
root. The SSH protocol cannot select or alter this profile. Keep the real
public-main freshness check enabled in rehearsal whenever its source is
available; any explicit expected-source override is accepted only by this
isolated root-admin fixture path.

## Compose and image transaction

At provisioning, copy the currently effective base, candidate, browser, and
image-only Compose inputs into durable root-owned files under
/etc/omniroute-deploy/compose/. Verify the copied project renders the same
services, ports, environment, mounts, init behavior, restart policy, networks,
and app/Redis image identities as the running production project. These
root-owned copies become the authoritative inputs for every deploy and
rollback. Do not depend on dated files under diagnostics or other temporary
snapshot paths. Before each stop, render the root-owned project and confirm
that omniroute is the only service to change and omniroute-redis remains the
same container/image. The service image is always pinned to the source
workflow's exact digest.

Validate the resolved effective configuration, not historical Compose config
hash labels. Compose's hash command can omit env-file resolution, and old
container hashes can encode different defaults. These metadata differences
must not require a Redis restart or version-specific compatibility code.
Render the protected inputs as JSON in memory and compare both running
services against explicit effective projections: project/service identity,
image reference and ID, merged environment, command, entrypoint, user,
working directory, init/restart/health configuration, ports, mounts, network
attachments, and user labels. Resolve inherited image defaults for this
comparison. Omit Compose-generated `com.docker.compose.*` label metadata,
including historical config paths and version/hash fields, from label
equality; enforce project/service identity separately. Protected fixed-input
path checks remain mandatory. Compare user/image labels exactly. Reject
unsupported or missing projection fields. Never print or persist environment
values.

Corroborate the baseline using the exact protected inputs and project in
`docker compose --dry-run --progress plain up -d --no-deps --no-build
--pull never omniroute`. Require exit zero and exactly the app's observed
`Running` no-op. Reject empty/unknown plans and any create, recreate, start,
stop, pull, build, Redis, or other service action. This check supplements the
effective-field comparison. Render the candidate with the temporary image
override; after replacing only its app image with the baseline image, the
entire JSON must equal the baseline. Recheck Redis ID/image/running/health
before cutover, during acceptance, immediately before commit, and after
rollback.

    baseline = render_resolved_fixed_project_in_memory()
    for service in [app, redis]:
        require runtime_projection(service) == effective_projection(baseline, service)
    require scoped_app_dry_run(baseline) == app_running_no_op
    candidate = render_fixed_project_with_digest_override()
    candidate.app.image = baseline.app.image
    require candidate == baseline
    require redis_identity_and_health_unchanged_at_each_transaction_gate()

Use this transaction order:

```text
1. Validate tuple; resolve duplicate attempt; acquire nonblocking flock.
2. Pull repository@digest. Inspect ARM64 architecture, exact digest,
   canonical source, source revision, and pinned base-digest OCI labels.
3. Confirm fixed Compose inputs and current app/Redis identities.
4. Check canonical public GitHub main SHA immediately before app stop.
   If it differs, persist SKIPPED_STALE and exit without app/DB mutation.
5. Record prior running image identity, stable image-override bytes,
   database owner/group/mode, and transaction status; recheck app identity.
6. Stop only omniroute. Leave Redis running.
7. Create a fresh protected SQLite online backup after all app writers
   have stopped. Hash it and validate it with the app's native SQLite.
   Require integrity_check = ok and no foreign_key_check rows.
8. Persist candidate_may_mutate=true and all rollback inputs before any
   Compose start that can run migrations.
9. Start only omniroute with a generated root-owned candidate override
   containing the exact digest:
   docker compose ... up -d --no-build --no-deps --pull never omniroute
10. Wait within a bound derived from the image health interval, timeout,
    retry count, start period, pull/start allowance, and route probes.
11. Check Docker health, container-loopback UI root HTTP 200, host public
    dashboard HTTP 200, container-loopback GET /api/v1/models HTTP 401
    with AUTH_002, SQLite integrity/FKs, exact migration source-ID
    coverage, and unchanged Redis identity.
12. Recheck Redis. Atomically replace only the persistent image-only
    override with the accepted digest. Record SUCCEEDED and retain backup.
```

Standalone SQLite backup and restored-file validation must permit SQLite to
create its own WAL/SHM files without changing SQL data. Before this check,
require no existing `-wal`, `-shm`, or `-journal` companion, including dangling
symlinks. Record main-file SHA-256, owner, group, and mode. Mount only the
snapshot parent writable into the pinned native validator; run as the DB's
numeric owner/group and retain `better-sqlite3` `readonly: true`. In `finally`,
remove only newly created regular companions owned by that same owner/group,
using `lstat` without following symlinks. Recheck main-file hash and metadata;
any invariant or cleanup failure rejects validation. Protected backups remain
root-owned 0600; restored files retain the app's recorded numeric ownership.

Live database validation retains the read-only complete data-directory mount
and actual shared WAL/SHM files. Require the actual main DB to be a regular
file via `lstat` and run the native validator as its exact numeric UID/GID,
without owner fallback. The validator drops all Linux capabilities; UID0
cannot bypass application-owned mode0660 data permissions without DAC
capabilities. The pinned-image reproduction changes only UID0 to UID1000:
the former returns CANTOPEN, the latter passes integrity/FK/full migration
coverage with the same read-only mount and real WAL/SHM. Live validation does
not delete sidecars or require a stable main hash while app writers run.
Never substitute a raw main-file copy,
ignore WAL through immutable mode, delete pre-existing companions, or add an
owner/version fallback. The isolated fixture working DB and data directory
must use the application's numeric UID/GID 1000; protected seeds remain root
owned.

```text
validate_standalone_snapshot(path):
    require no companion exists (lexists includes dangling symlinks)
    before = main_file_hash_and_owner_group_mode(path)
    try:
        result = native_readonly_sql(parent_mount=writable,
                                     user=before.uid:before.gid)
    finally:
        for companion newly created by this check:
            require lstat is regular and owner/group == before.owner/group
            unlink companion without following links
        require main_file_hash_and_owner_group_mode(path) == before
    require native integrity/FK checks pass
```

Private UI/API probes execute inside the existing app container through its
Node runtime at `http://127.0.0.1:20128`. The production host publishes the
private gateway listener on 20129; that listener does not serve these UI/API
routes. Keep the existing binding. The public dashboard check runs from the
host through its configured HTTPS URL for candidate acceptance. Use the same
private probe context for the candidate and previous image, in production
and the isolated fixture; rollback skips the public check. Return
only sanitized status/error-code data from container probes; never emit HTTP
response bodies. The fixture's deliberately failing public dashboard URL is
`http://127.0.0.1:<explicit-port>/dashboard/radar`. A temporary root-controlled
host-loopback proxy forwards that fixed path only to the isolated fixture
gateway on port 20129 and relays its actual HTTP status. Internal Docker
networks suppress published ports, so fixture services declare no host ports.
The proxy does not grant fixture containers access to external networks.

The Compose invocation always uses --no-build, --no-deps, and --pull never
after the exact digest has been pulled. It never rebuilds source, resolves
deployment identity from main, or restarts Redis. The mutable main ref is
only a freshness signal through the public GitHub API.

The DB validator runs against the live DB using the candidate's bundled
Node/SQLite implementation. It requires:

- PRAGMA integrity_check returns exactly ok.
- PRAGMA foreign_key_check returns no rows.
- The sorted numeric migration IDs from candidate /app/migrations/*.sql
  exactly equal numeric IDs in _omniroute_migrations; preserve but ignore
  the existing nonnumeric legacy rows.
- Both checks run after startup migrations and again after restoring the
  pre-deploy snapshot under the old image.

## Automatic failure recovery

Failures before app stop leave production unchanged. If the app was stopped
but no valid snapshot exists and candidate_may_mutate is still false, restart
the prior image against the untouched DB and verify health. Once
candidate_may_mutate is true, every failure enters automatic rollback:

    try:
        stop omniroute only
        if candidate database exists:
            create root-only SQLite diagnostic backup
        remove storage.sqlite-wal and storage.sqlite-shm
        restore protected pre-deploy backup to storage.sqlite atomically
        require restored DB SHA-256 equals protected backup SHA-256 manifest
        restore captured DB owner, group, and mode
        validate restored DB integrity and foreign keys
        restore exact prior image-only override atomically
        start only omniroute with no build, dependencies, or pull
        verify old image identity, Docker health, UI, API auth, and DB checks
        persist FAILED with rollback_succeeded and primary failure tag
    on any restore or prior-service failure:
        keep omniroute stopped
        preserve original backup and candidate diagnostic copy
        persist FAILED with rollback_failed and bounded failure tag

Never overwrite or remove the original backup during restoration. Remove
candidate WAL/SHM before replacing the DB so SQLite cannot replay writes from
the failed candidate. Keep the captured previous image locally until the
transaction is terminal. Logs contain run ID, attempt, digest, phase, and
bounded error tags; never DB rows, HTTP response bodies, keys, or secret
environment values.

Because the host has no confirmed maintenance proxy, the candidate may accept
requests during the short acceptance window. If a later check fails, the
requested DB restore can discard writes made after candidate startup. The
workflow does not claim zero downtime or preserve those candidate-era writes.

## Focused manual verification

Use a root-admin fixture project with a cloned production-format DB and the
same actual launcher, systemd transaction, Compose commands, backup helper,
and restore helper. For a deterministic real-migration rehearsal, delete
only version 196 from the cloned fixture database's migration ledger; the
current migration is safe to rerun. Configure the fixture's candidate
dashboard probe through the loopback proxy to its gateway's actual 404. The candidate then writes
through its real startup migration and fails the real dashboard acceptance
check. Record the protected pre-deploy backup file SHA-256 in the transaction
manifest. Immediately after atomic restore and before the prior image starts,
require the restored DB file SHA-256 to equal that backup-file SHA-256
byte-for-byte. Do not compare with the live DB file hash from before backup
creation: SQLite's online backup can produce different bytes while preserving
the same logical database. The old image may legitimately reapply migration
196 after it starts.

The fixture must use separate paths, project name, containers, and only
internal nonexternal networks. All fixture services have empty published-port
lists. The root-owned mode-0600 profile accepts only the literal loopback HTTP
URL above, with no credentials, query, or fragment. No production network,
firewall, or binding changes are part of this fixture. The proxy process is
temporary, binds only loopback, masks request/body logs, and is stopped after
the proof while protected database artifacts remain. Its fixed forwarding
target must resolve only to the fixture app on the isolated fixture network.

```text
create isolated fixture with no published container ports
start root-controlled loopback proxy for fixed /dashboard/radar
on proxy GET: resolve fixture app on its internal network
              request fixture gateway20129 at fixed dashboard path
              relay only actual bounded HTTP status; emit no body/log secrets
check private Node probes pass and proxy receives actual404
delete only cloned ledger196 while fixture app is running
submit normal fixture transaction; prove migrated candidate then DB restore
stop temporary proxy; retain protected snapshots and sanitized proof
```

Never fault-inject against production or add production-helper
fault-injection flags. Manually verify publisher gating; successful
digest/SHA/run/attempt transport; stale runner and host checks; invalid and
hostile fields; extra bytes; wrong host key; duplicate reattachment; rerun
attempt separation; server lock contention; runner/SSH disconnect; exact
image/OCI checks; Redis stability; successful migration acceptance;
post-migration rollback; and rollback failure leaves the app stopped. Inspect
Actions and journald output for bounded errors and absence of secrets or DB
contents.
