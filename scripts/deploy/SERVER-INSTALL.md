# OmniRoute deployment helper: server installation

This package installs a restricted GitHub Actions entry point and a root-owned
transaction worker. The SSH account can submit one validated record; it cannot
choose a repository, image, Compose file, service, environment, path, or
profile.

## Fixed programs and permissions

Install the repository files at these fixed paths, owned by `root:root`:

| Source file                       | Installed path                                       | Mode   |
| --------------------------------- | ---------------------------------------------------- | ------ |
| `omniroute-deploy.py`             | `/usr/local/libexec/omniroute-deploy.py`             | `0644` |
| `migration-catalog.cjs`           | `/usr/local/libexec/omniroute-migration-catalog.cjs` | `0644` |
| `omniroute-ssh-gate.sh`           | `/usr/local/libexec/omniroute-deploy-gate`           | `0755` |
| `omniroute-deploy-launcher.sh`    | `/usr/local/sbin/omniroute-deploy`                   | `0755` |
| `omniroute-deploy-transaction.sh` | `/usr/local/libexec/omniroute-deploy-transaction`    | `0755` |

Create `/etc/omniroute-deploy/compose/` as `root:root` mode `0700`. Keep
production configuration at `/etc/omniroute-deploy/production.json`, owned by
`root:root` mode `0600`. Create
`/opt/apps/omniroute-deploy-diagnostics/` and its `status/` and `transactions/`
children as `root:root` mode `0700`. The SSH user must not be in the Docker
group and must not be able to read this configuration, SQLite data, or
diagnostics.

The transaction program uses only Python 3.6 standard-library modules and
the host `sqlite3` CLI. Database validation runs `node` and the application's
bundled `better-sqlite3` from the image being checked. Docker and its Compose
plugin remain the root user's default installation; only image pull uses a
fresh empty Docker config.

## Production configuration

Provision four durable Compose files under `/etc/omniroute-deploy/compose/`:

1. `base.yml`
2. `candidate.yml`
3. `browser.yml`
4. `image.yml`

Copy the effective production project into the first three files. `image.yml`
contains only the current `omniroute` image override and is the only Compose
file the helper later changes. Preserve the current project directory's
`.env` and every referenced root-owned `env_file` at the location used by
Compose. The copies must render the same app and Redis services, environment,
ports, init behavior, mounts, restart policy, and networks as the running
project. The app database bind mount must resolve to
`/opt/apps/omniroute/data/`. The helper compares the live app and Redis runtime
fields against the freshly resolved Compose model before it stops anything.
It checks project/service identity separately, ignores only Compose-generated
labels, and uses an app-only Compose dry-run
that must report the app as already running without selecting Redis. Candidate
Compose rendering must differ from the baseline only in the app image. Do not
use Compose config-hash labels as proof: their values vary with Compose version
and environment-file resolution.

Create `/etc/omniroute-deploy/production.json` with this shape. Replace the
`public_dashboard_url` with the verified production dashboard URL; do not add
credentials, query strings, or fragments. Private UI/API destinations are fixed
inside the app container and are not configuration fields.

    {
      "profile": "production",
      "compose_project_name": "omniroute",
      "compose_files": [
        "/etc/omniroute-deploy/compose/base.yml",
        "/etc/omniroute-deploy/compose/candidate.yml",
        "/etc/omniroute-deploy/compose/browser.yml",
        "/etc/omniroute-deploy/compose/image.yml"
      ],
      "project_dir": "/opt/apps/omniroute",
      "data_dir": "/opt/apps/omniroute/data",
      "database_path": "/opt/apps/omniroute/data/storage.sqlite",
      "image_override_path": "/etc/omniroute-deploy/compose/image.yml",
      "state_root": "/opt/apps/omniroute-deploy-diagnostics/status",
      "backup_root": "/opt/apps/omniroute-deploy-diagnostics/transactions",
      "candidate_root": "/opt/apps/omniroute-deploy-diagnostics/transactions",
      "lock_path": "/run/lock/omniroute-deploy.lock",
      "app_service": "omniroute",
      "redis_service": "omniroute-redis",
      "app_container": "omniroute",
      "redis_container": "omniroute-redis",
      "migration_catalog_path": "/usr/local/libexec/omniroute-migration-catalog.cjs",
      "public_dashboard_url": "https://<verified-public-dashboard-host>/"
    }

The private UI and API probes run with Node inside the app container at its
fixed `127.0.0.1:20128` listener. The UI probe follows at most five redirects
on that same loopback origin and requires HTTP 200; the API probe requires an
unauthenticated HTTP 401 with `AUTH_002`. The public dashboard probe runs from
the host, must use HTTPS, and must return HTTP 200. Do not add app ports to
Compose for deployment health checks.

## Restricted SSH entry

Create a locked, dedicated `omniroute-deploy` account with no Docker-group
membership. Keep its home and `.ssh/authorized_keys` root-owned; install only
the deployment public key. Use its forced command and the exact no-argument
sudo entry below. The account's key line must be the only authorized key:

    restrict,command="/usr/local/libexec/omniroute-deploy-gate" ssh-ed25519 <DEPLOY_PUBLIC_KEY>

The `restrict` key option disables PTY, agent, X11, and port forwarding. The
gate accepts only `SSH_ORIGINAL_COMMAND=deploy-main` and calls:

    /usr/bin/sudo -n /usr/local/sbin/omniroute-deploy

Install `/etc/sudoers.d/omniroute-deploy` as `root:root` mode `0440`, then
validate it with `visudo -cf`:

    Defaults:omniroute-deploy env_reset
    Defaults:omniroute-deploy !setenv
    omniroute-deploy ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/omniroute-deploy ""

The empty quoted argument in sudoers restricts this command to no arguments.
Do not grant sudo access to Docker, a shell, a directory, or any other
command. The gate rejects invalid input before sudo and both Python
boundaries validate the record again.

The wire record is exactly one LF-terminated line with four space-separated
fields:

    <sha256:64-lowercase-hex> <40-lowercase-hex-source-sha> <positive-run-id> <positive-run-attempt>

Run ID is at most 20 decimal digits; attempt is at most 10. The durable
transaction key is `<run-id>-<attempt>`. Repeating the same tuple reattaches
to its running or terminal result. A different tuple with the same key is
rejected. A GitHub rerun uses its incremented attempt and starts a separate
transaction.

The only terminal output is `SUCCEEDED <key>`, `SKIPPED_STALE <key>`, or
`FAILED <key> <SAFE_CODE>`. Success and stale skip exit zero; failure exits
nonzero. The gate filters the root helper's output and never forwards raw
stderr, response bodies, paths, or database data.

## Root-admin fixture profile

The root-only CLI can use a separate fixture configuration. SSH cannot select
this profile. The JSON file must be owned by `root:root` mode `0600`; its
`fixture_root` must contain only letters, digits, `.`, `_`, `/`, and `-`.
Use an isolated root such as
`/opt/apps/omniroute-deploy-rehearsals/cd-fixture-20261003T213651Z`. Put every
Compose file, bind mount, database, status file, backup, candidate override,
and lock beneath that root. Fixture networks must be internal and non-external;
do not attach Traefik or other host-facing providers. Fixture services may not
use named or anonymous Docker volumes. Use a unique project and container
name. Fixture Compose files must not publish ports for any service, including
the optional browser service. A root-controlled fixture proxy listens on the
loopback-only `public_dashboard_url` port and forwards the fixed dashboard
request to the app container's internal gateway on port 20129. It passes
through the app's actual HTTP status, masks request/response details, and is
removed after the rehearsal. The helper still probes this URL through its
normal dashboard acceptance check; private UI/API probes stay inside the app
container.

The fixture configuration uses these fields:

    {
      "profile": "fixture",
      "fixture_root": "/opt/apps/omniroute-deploy-rehearsals/cd-fixture-20261003T213651Z",
      "compose_project_name": "omniroute-cd-fixture-20261003t213651z",
      "compose_files": [
        "<fixture-root>/compose/base.yml",
        "<fixture-root>/compose/candidate.yml",
        "<fixture-root>/compose/browser.yml",
        "<fixture-root>/compose/image.yml"
      ],
      "project_dir": "<fixture-root>",
      "data_dir": "<fixture-root>/dbdata",
      "database_path": "<fixture-root>/dbdata/storage.sqlite",
      "image_override_path": "<fixture-root>/compose/image.yml",
      "state_root": "<fixture-root>/status",
      "backup_root": "<fixture-root>/transactions",
      "candidate_root": "<fixture-root>/transactions",
      "lock_path": "<fixture-root>/lock/transaction.lock",
      "app_service": "omniroute",
      "redis_service": "redis",
      "app_container": "omniroute-cd-fixture-app",
      "redis_container": "omniroute-cd-fixture-redis",
      "migration_catalog_path": "/usr/local/libexec/omniroute-migration-catalog.cjs",
      "public_dashboard_url": "http://127.0.0.1:<fixture-proxy-port>/dashboard/radar",
      "fixture_expected_source_sha": "<optional-40-character-sha>"
    }

Replace every `<...>` field before saving; those placeholders are not accepted
configuration. `fixture_expected_source_sha` is optional and only allows the
fixture to continue when the public GitHub main API is unavailable. If the
API returns a different current SHA, the fixture is skipped as stale.

For the real migration rollback rehearsal, copy production SQLite into the
fixture with SQLite's online backup and start the isolated fixture app and
Redis until their normal health checks pass. Start the root-controlled
loopback proxy before submission; it forwards only `/dashboard/radar` to the
fixture app's internal port 20129. While the app remains running, use one
native transaction to remove only `version='196'` from the copied
`_omniroute_migrations` table. Do not delete the migration's index or edit its
SQL. Immediately submit the normal transaction with the current image digest
and matching source SHA; do not restart the app between removing the ledger
row and submitting. The helper requires running fixture services during
preflight, then stops only the fixture app before making its protected online
backup. Candidate startup applies the actual migration to the copied DB; the
fixture app's gateway returns its actual HTTP 404 through the loopback proxy,
so the normal dashboard check fails candidate acceptance. The helper captures a root-only candidate DB backup (or, if SQLite
cannot create one, the stopped DB/WAL/SHM files), restores the protected online
backup, and verifies its exact SHA-256 before starting the previous image.
Rollback probes the private UI and API inside the app container only, so the
candidate dashboard 404 does not force a second rollback. Stop and remove the
proxy after saving the transaction result and rollback evidence.

Submit a fixture transaction as root with the same helper and systemd unit:

    sudo /usr/bin/python3 /usr/local/libexec/omniroute-deploy.py --config /opt/apps/omniroute-deploy-rehearsals/cd-fixture-20261003T213651Z/fixture.json <<'DEPLOY'
    sha256:<64-lowercase-hex> <40-lowercase-source-sha> <positive-run-id> <positive-run-attempt>
    DEPLOY

Use the digest and source labels from an ARM64 image in the fixed repository.
The CLI prints only the sanitized terminal status. Reuse the exact tuple to
read its result; increment attempt for a new rehearsal transaction.
