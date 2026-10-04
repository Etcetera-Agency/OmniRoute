# Change: Deploy verified main images over restricted SSH

**Status:** Authorized for implementation by the user's request on 2026-10-03.

## Why

The only automatic image workflow already builds, verifies, and publishes the
ARM64 main image. Production still needs an operator to pull it and run the
app's startup migrations. That leaves a gap between a verified main image and
the running production app.

The user requested unattended deployment as soon as the main image is ready,
with a fresh pre-deploy SQLite backup and automatic restoration of both that
backup and the prior image when deployment acceptance fails.

## What Changes

- Extend the existing sole image workflow with a production deploy job gated
  on successful publication of the immutable image digest and successful
  update of the main tag.
- Recheck that the source commit is still canonical main immediately before
  SSH. Pass only the published digest, source SHA, workflow run ID, and run
  attempt.
- Limit production credentials to a main-only GitHub Environment. Use a
  pinned SSH host key, dedicated forced-command account, fixed root-owned
  helper, and one nonblocking host lock.
- Preserve the effective production Compose configuration in durable
  root-owned copies under /etc/omniroute-deploy. Pull and run the exact
  digest; never build on the server or restart Redis.
- Stop only the app to quiesce SQLite writers, create and validate a fresh
  native SQLite backup, then start the candidate so its normal startup
  applies migrations.
- Verify image identity, app health, dashboard and API behavior, SQLite
  integrity, foreign keys, migration-ledger coverage, and unchanged Redis.
  On post-migration acceptance failure, retain a protected diagnostic copy,
  restore the fresh pre-deploy database and prior image, then verify the
  restored service.
- Persist each transaction under run ID plus attempt. Repeated identical
  requests reattach to the existing result; a GitHub rerun is a new
  transaction.

## Impact

### Affected Specifications

- Adds the main-image-ssh-cd capability.
- Modifies github-overlay-image-build's server deployment requirement. The
  former operator-run, no-migrations boundary is replaced by unattended,
  digest-pinned deployment and automatic database/image rollback.

### Affected Code and Operations

- .github/workflows/omni-overlay-image.yml: publication outputs, job
  concurrency, and production deploy job.
- Tracked deploy transport helper: request validation, fresh-main check,
  pinned SSH setup, and bounded result reporting.
- etc2nd-shlink: dedicated deploy account/key, exact forced command,
  root-owned helper and systemd transaction, root-only config/status/backup
  paths, and service-specific sudo rule.
- Existing Compose project: copy its effective base, candidate, browser,
  and image-only inputs into the root-owned deployment config; update only
  the persistent image digest after acceptance.
- Manual focused harness and isolated production-Compose rehearsal; no
  general CI test workflow is added.

### User Impact

After a verified current-main image is published, the same workflow deploys
it without an approval pause. The app stops briefly while a consistent SQLite
backup is made and migrations run. If candidate acceptance fails, the host
restores the backup and previous image automatically.

The server has no verified ingress maintenance gate. The candidate can accept
requests during its short acceptance window. If acceptance then fails,
automatic database restoration can discard writes made after the candidate
started. This is the explicit consequence of the requested automatic
database rollback.

### Boundaries

- The image digest, never a mutable tag, identifies the deployment.
- GitHub Actions cannot run arbitrary commands, select Compose paths, supply
  an image reference, access the production database, or invoke root directly.
- The deploy account has no general shell, forwarding, TTY, Docker access, or
  data-directory access.
- A failed database restore or failed prior-image health check leaves the app
  stopped and records FAILED; it never starts an app against an unverified
  database.
- No reverse migrations, compatibility layer, or signed-attestation
  infrastructure is introduced.
