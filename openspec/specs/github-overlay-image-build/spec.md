# github-overlay-image-build Specification

## Purpose

Build and verify the fork's native ARM64 runtime from canonical main, publish
the accepted artifact to public GHCR by source SHA and digest, and preserve
manual-only task tests outside the image workflow.

## Requirements

### Requirement: Keep the main image workflow as the only automatic test-related workflow

The repository SHALL NOT automatically run general, unit, static-check, or
workflow-check jobs on feature pushes, pull requests, main pushes, or
schedules. The fork image workflow SHALL run only on a push to
`refs/heads/main` or a manual dispatch selected on exact
`refs/heads/main`. Other test workflows SHALL remain manually invocable when
needed for a task or otherwise disabled; they SHALL NOT have push, pull
request, or schedule triggers. The routine check workflows
`api-route-typecheck.yml`, `test-quarantine.yml`, and
`release-acceptance.yml` SHALL be manual-dispatch-only. Keep routine check
workflows disabled in repository settings; if a specific task requires one,
enable and dispatch it manually, then return it to disabled. Preserve only the
fork image workflow as active between such task-specific runs. Review code
changes manually before merge.

#### Scenario: Main push builds the image

- **GIVEN** a commit reaches `refs/heads/main` in the canonical repository
- **WHEN** the image workflow runs
- **THEN** it builds and verifies one native ARM64 candidate
- **AND** it publishes only after every container artifact check passes

#### Scenario: Manual main image dispatch

- **GIVEN** a user manually dispatches the fork image workflow with selected
  ref exactly `refs/heads/main`
- **WHEN** the workflow runs
- **THEN** it builds and verifies the selected main commit
- **AND** it may publish only after every container artifact check passes

#### Scenario: Feature push, pull request, or schedule

- **GIVEN** a feature push, pull request, main push for an auxiliary test
  workflow, or scheduled time occurs
- **WHEN** GitHub evaluates the repository workflows
- **THEN** no general, unit, static-check, or workflow-check job starts
- **AND** no image is built or published by those events

#### Scenario: Manual non-main image dispatch

- **GIVEN** a user manually dispatches the image workflow on a ref other than
  exact `refs/heads/main`
- **WHEN** GitHub evaluates the workflow
- **THEN** no image build or publication job runs

#### Scenario: Task-specific manual test

- **GIVEN** a task requires a focused test or check
- **WHEN** an operator runs the relevant test command or explicitly enables
  and dispatches a manual-only workflow for that task
- **THEN** only that requested task-specific test runs
- **AND** it does not become a push, pull-request, main, or scheduled gate

### Requirement: Build from the pinned official UI image without test gates

The image workflow SHALL use native `ubuntu-24.04-arm` and
`docker/official-backend-overlay.Dockerfile` with official base
`ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`.
It SHALL compile backend routes exactly once, preserve the official dashboard
and runtime, and load one `linux/arm64` candidate. The image workflow and
Docker builder SHALL NOT run unit, general, or static test gates. They SHALL
NOT use QEMU, a paid larger runner, or a self-hosted runner. Before
`npm run build:backend`, the Docker builder SHALL set
`NODE_ENV=production` after `npm ci` and SHALL set
`NODE_OPTIONS=--max-old-space-size=12288` in the builder stage only. The
runtime stage SHALL start from a fresh pinned-base stage and SHALL NOT copy
the builder-stage overrides into runtime configuration.

#### Scenario: Main candidate build

- **GIVEN** a checked-out canonical main commit and the pinned official base
- **WHEN** the image builder creates its candidate
- **THEN** it runs `npm ci` before changing the build environment
- **AND** it sets builder-stage `NODE_ENV=production` and
  `NODE_OPTIONS=--max-old-space-size=12288` before backend compilation
- **AND** it performs one backend-only compilation without invoking unit-test
  commands
- **AND** the candidate retains the official dashboard, static files, and
  runtime configuration
- **AND** one local candidate is loaded for artifact verification

#### Scenario: Base image has an inherited Node heap setting

- **GIVEN** the official base provides an inherited `NODE_OPTIONS` value and
  the first main build reached an effective V8 old-space limit near 1043 MiB
- **WHEN** the builder runs `npm run build:backend`
- **THEN** the explicit builder-stage 12288-MiB value overrides the inherited
  option for this compile
- **AND** no Node heap override is added to the final runtime stage

#### Scenario: Builder leaves dependency-install development mode set

- **GIVEN** the Dockerfile sets `NODE_ENV=development` for `npm ci`
- **AND** `npm ci` has completed with its original environment
- **WHEN** the builder runs `npm run build:backend`
- **THEN** the compiler sees `NODE_ENV=production`
- **AND** this environment setting remains confined to the builder stage

The second main build `37125217705` failed during `/_global-error` prerender
with `TypeError: Cannot read properties of null (reading 'use')` and a Next
worker exit. Read-only diagnosis found the Dockerfile's development environment
setting for `npm ci` persisted through dependency installation and was
preserved by the installed Next CLI; the build log also showed React development warnings. The exact
minified callsite was not isolated. The selected builder-only production-mode
setting is a testable correction to that observed state; the next main build
must pass before the image gate closes.

#### Scenario: Cache unavailable

- **GIVEN** no reusable ref-scoped BuildKit cache exists
- **WHEN** the main image workflow builds
- **THEN** it performs a clean build
- **AND** cache absence does not change build correctness

### Requirement: Verify the actual container artifact before publication

The main image workflow SHALL start and inspect its local candidate before
GHCR authentication or publication. It SHALL start the candidate service
container with Docker init enabled (`docker run --init`, equivalent to Docker
API `HostConfig.Init=true`) to match production process startup, forward
signals, and reap child processes. Apply Docker init only to that candidate
service-container startup; browser smoke SHALL use `docker exec` in the
already-running candidate. It SHALL check ARM64 architecture and
source/revision/base metadata, native SQLite operation, configured Docker
`HEALTHCHECK` status, direct UI root response, API behavior, and official UI
preservation by comparing
`BUILD_ID`, the full static tree, page manifest, and every non-API app-path
entry with the pinned official image. With `REQUIRE_API_KEY=true`, the direct
Next UI listener SHALL return HTTP 401 with `error.code: "AUTH_002"` for
unauthenticated `GET /api/v1/models`; client-API auth middleware rejects the
request before the catalog handler. Smoke checks SHALL use disposable
container-scoped data and SHALL NOT access production credentials or data. A
failed artifact check SHALL
stop the workflow before registry authentication and SHALL publish no image.
The direct UI listener on port `20128` SHALL return HTTP 200 for `/`; health
SHALL be checked through Docker's configured `HEALTHCHECK`. The verifier SHALL
NOT treat an API-proxy response on port `20129` as UI health.
The candidate SHALL mount `/app/data` as container-scoped tmpfs with mode
`1777`, preserve the image's default `USER`, and SHALL NOT bind host temporary
data to the candidate. Verifier cleanup SHALL collect errors without replacing
an earlier verification error. A verification error SHALL remain primary and
be reported with every cleanup error. If artifact checks pass but cleanup
fails, verification SHALL still fail before registry authentication.
If the unauthenticated catalog assertion fails, its diagnostic SHALL include
the expected status/code, observed HTTP status, and only bounded, sanitized
`error.type` and `error.code` values read from a JSON response. It SHALL NOT
log response bodies, headers, credentials, model data, or serialized error
objects. This diagnostic SHALL NOT weaken the auth fixture or expected HTTP
401 / `AUTH_002` behavior.

#### Scenario: Candidate passes artifact verification

- **GIVEN** the candidate has matching architecture, source, revision, and
  official-base identity
- **AND** candidate service startup uses Docker init (`HostConfig.Init=true`)
- **AND** disposable native SQLite check passes
- **AND** Docker reports the configured `HEALTHCHECK` as healthy
- **AND** direct UI listener `20128` returns HTTP 200 for `/`
- **AND** direct API behavior passes
- **AND** unauthenticated `GET /api/v1/models` on the direct UI listener
  returns HTTP 401 with `error.code: "AUTH_002"` when
  `REQUIRE_API_KEY=true`
- **AND** Chromium launches through Playwright with `headless: false` as the
  default non-root user, opens only `about:blank`, and closes cleanly under
  Xvfb
- **AND** all checked UI build assets and non-API paths match the pinned
  official image
- **AND** candidate `/app/data` uses container-scoped tmpfs mode `1777` with
  the image's default `USER`
- **AND** every verifier cleanup action completes without error
- **WHEN** artifact verification completes
- **THEN** the publisher may authenticate and publish that candidate

#### Scenario: Candidate process startup matches production

- **GIVEN** production Compose starts the service with `HostConfig.Init=true`
- **WHEN** the verifier starts the candidate service container
- **THEN** it enables Docker init (`docker run --init`)
- **AND** the app health and route checks run in that same initialized
  container
- **AND** browser smoke executes inside that container with `docker exec`
- **AND** no second app container is created for browser verification

#### Scenario: Candidate artifact check fails

- **GIVEN** any identity, native SQLite, health, route, UI comparison, or
  browser smoke fails
- **WHEN** the main image workflow evaluates the candidate
- **THEN** the workflow fails before GHCR login
- **AND** no tag is published or updated

#### Scenario: Catalog-auth assertion fails with safe diagnostics

- **GIVEN** unauthenticated direct UI `GET /api/v1/models` does not return the
  expected HTTP 401 and `error.code: "AUTH_002"`
- **WHEN** the verifier reports the failed assertion
- **THEN** the message includes expected status/code and observed HTTP status
- **AND** it includes only bounded, sanitized `error.type` and `error.code`
  values from the JSON response when available
- **AND** it does not include response bodies, headers, credentials, model
  data, or serialized error objects
- **AND** GHCR authentication and publication do not occur

#### Scenario: Verification and cleanup both fail

- **GIVEN** a primary artifact-verification error and one or more cleanup errors
- **WHEN** the verifier completes cleanup
- **THEN** it reports the primary verification error first
- **AND** it reports every cleanup error without replacing the primary error
- **AND** publication is blocked

#### Scenario: Cleanup fails after artifact checks pass

- **GIVEN** all artifact checks pass but a cleanup action fails
- **WHEN** the verifier completes
- **THEN** verification fails and reports the cleanup error
- **AND** GHCR authentication and publication do not occur

### Requirement: Publish a traceable main image

The canonical main image publisher SHALL, only after all container artifact
checks pass, publish `ghcr.io/etcetera-agency/omniroute` under the full source
commit SHA and `main` tags. Only a verified `refs/heads/main` run SHALL update
`:main`; both tags SHALL refer to the verified candidate. The publisher SHALL
use only `GITHUB_TOKEN` scoped to `contents: read` and `packages: write`, and
SHALL record the actual registry manifest digest, canonical source URL,
source SHA, pinned base digest, and Actions run URL. OCI source, revision, and
base-digest labels SHALL match those values. Tags SHALL NOT be treated as
immutable; the manifest digest is the image identity. The workflow SHALL NOT
change package visibility or add signed-attestation infrastructure. It SHALL
append source URL, full-SHA tag, manifest digest, pinned official base,
verified OCI-label status, `:main` update status, and workflow run URL to
`GITHUB_STEP_SUMMARY`. The workflow SHALL render dynamic values as quoted data
arguments to a fixed, single-quoted `printf` format so Markdown backticks stay
literal and values cannot become shell commands.

#### Scenario: Main publication succeeds

- **GIVEN** all container artifact checks pass for a main candidate
- **WHEN** the publisher completes
- **THEN** the full-SHA and `:main` tags resolve to the same manifest digest
- **AND** the run summary records digest, source, revision, base digest, and
  workflow run URL
- **AND** OCI labels match the summary

#### Scenario: Publication summary preserves values

- **GIVEN** the main image was published and the public summary values are set
- **WHEN** the workflow writes the Actions summary
- **THEN** each source, tag, digest, base, and run URL appears unchanged
- **AND** Markdown backticks appear as literal characters
- **AND** no command substitution is executed for a dynamic value

### Requirement: Preserve browser providers in the main image

The main workflow SHALL build the `runtime-web` target derived from the
verified `runtime` image. It SHALL split lockfile dependency installation into
a shared `backend-dependencies` stage, with `backend-builder` derived from
that stage, so source compilation occurs once and the web runtime can reuse
the pinned `playwright` and `playwright-core` packages. Selecting the
`prebuilt-backend` artifact SHALL NOT force `backend-builder` to compile merely
to provide browser packages.

The `runtime-web` target SHALL copy only the lockfile-resolved Playwright
packages from `backend-dependencies`, install Chromium and its required OS
libraries with Playwright's CLI `--with-deps`, and install Xvfb and Xauth. It
SHALL set `PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright` and make
the browser cache available to the default `node` user. Its entrypoint SHALL
run the existing `/app/check-permissions.sh` through
`xvfb-run -a -s '-screen 0 1920x1080x24 -nolisten tcp'`. The base image's
`CMD` does not carry through an `ENTRYPOINT` override: `runtime-web` SHALL
declare the official default command as
`CMD ["node", "dev/run-standalone.mjs"]` in the current stage. The pinned-base
Docker `HEALTHCHECK` SHALL remain unchanged. The target SHALL preserve the
pinned official UI and existing app manifests.

Before candidate startup and registry authentication, verification SHALL
inspect the image configuration and require `User` to be `node`, `Entrypoint`
to be the exact Xvfb permission-check command and arguments specified above,
and `Cmd` to be `["node", "dev/run-standalone.mjs"]`. A missing or different
value SHALL fail before container startup. The failure diagnostic SHALL report
only the expected and observed `User`, `Entrypoint`, and `Cmd` fields; it SHALL
NOT log environment variables or other image configuration. After this
preflight, candidate verification SHALL launch Chromium through Playwright
with `headless: false` as the default non-root user, open only `about:blank`,
and close cleanly under Xvfb without external requests. Any failure SHALL
block publication.

#### Scenario: Browser-capable main candidate passes verification

- **GIVEN** the source or selected prebuilt backend overlay is merged into the
  pinned official runtime
- **AND** `runtime-web` contains lockfile-matched Playwright packages and
  Chromium at the configured browser path
- **AND** image config has `User: node`, the expected Xvfb entrypoint, and
  `Cmd: ["node", "dev/run-standalone.mjs"]`
- **AND** its permission-check entrypoint runs under Xvfb with the pinned-base
  healthcheck unchanged
- **WHEN** the verifier launches non-root Chromium with `headless: false`
- **THEN** the browser opens `about:blank` and closes successfully
- **AND** the official UI assets and manifests remain unchanged
- **AND** publication may proceed only after all other artifact checks pass

#### Scenario: Browser runtime is missing or cannot launch

- **GIVEN** the candidate lacks required browser packages, binaries, or Xvfb
- **OR** non-root Chromium cannot launch or close successfully
- **WHEN** the artifact verifier checks the browser runtime
- **THEN** verification fails before GHCR authentication
- **AND** no image tag is published or updated

#### Scenario: Candidate command configuration is missing or incorrect

- **GIVEN** the candidate image's `User`, `Entrypoint`, or `Cmd` differs from
  the required runtime-web configuration
- **WHEN** the verifier performs image-config preflight
- **THEN** it fails before starting the candidate container
- **AND** it reports only expected and observed `User`, `Entrypoint`, and
  `Cmd` values
- **AND** GHCR authentication and publication do not occur

#### Scenario: First package publication

- **GIVEN** GHCR creates the fork package on its first image publication
- **WHEN** the workflow publishes the image
- **THEN** it leaves the default private visibility unchanged
- **AND** the owner changes package visibility to public in GitHub Packages
- **AND** an anonymous pull is verified before the server consumes the image

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
