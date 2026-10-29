# github-overlay-image-build Specification

## Purpose

Build and verify the fork's native ARM64 runtime from canonical main, publish
the accepted artifact to public GHCR by source SHA and digest, and preserve
manual-only task tests outside the image workflow.

## Requirements

### Requirement: Keep the main image workflow as the only automatic test-related workflow

Only the fork image workflow SHALL run automatically from exact-main push or dispatch; generic tests/checks and other test workflows remain manual or disabled, with routine checks restored to disabled after task runs.

#### Scenario: Feature push triggers no task tests

- **GIVEN** A feature branch receives a push
- **WHEN** Workflow triggers are evaluated
- **THEN** No general test or image workflow runs automatically

### Requirement: Build from the pinned official UI image without test gates

The image SHALL build once on native ARM64 from the pinned official UI base, without test gates or unsupported runners, and builder-only production settings SHALL not leak into runtime.

#### Scenario: Build uses the pinned base without tests

- **GIVEN** An exact-main image run begins
- **WHEN** The candidate image is built
- **THEN** It uses the pinned ARM64 base and runs no test gate

### Requirement: Verify the actual container artifact before publication

The workflow SHALL verify the running candidate’s architecture, provenance, UI/API behavior, official artifacts, health, isolation, and cleanup before registry authentication; any failed check blocks publication.

#### Scenario: Failed artifact check blocks publication

- **GIVEN** A candidate fails its direct UI check
- **WHEN** The workflow reaches publication gates
- **THEN** Registry authentication and publication do not occur

### Requirement: Publish a traceable main image

Only a verified main candidate SHALL publish source-SHA and `main` tags with recorded manifest digest, canonical source, base provenance, scoped credentials, and safe summary evidence.

#### Scenario: Main publication records its digest

- **GIVEN** All candidate checks pass on canonical main
- **WHEN** The publisher runs
- **THEN** Both tags refer to the verified candidate and the manifest digest is recorded

### Requirement: Preserve browser providers in the main image

The main image SHALL retain the verified browser runtime, lockfile-resolved Playwright packages, pinned-base startup contract, non-root image identity, and isolated browser smoke.

#### Scenario: Browser runtime remains non-root and offline

- **GIVEN** The browser candidate is inspected
- **WHEN** The smoke test launches Chromium
- **THEN** It runs as the default user without external requests

### Requirement: Pull and deploy the verified main image on the server without building source

Production SHALL consume only a published ARM64 digest after runner and host freshness checks, then use durable Compose and protected SQLite acceptance/rollback without building source on the server.

#### Scenario: Stale source causes no production mutation

- **GIVEN** Canonical main has advanced from the published SHA
- **WHEN** The runner freshness gate checks the source
- **THEN** Deployment is skipped before SSH and production remains unchanged

### Requirement: Build only exact-main image candidates automatically or by dispatch

The fork image workflow SHALL run only on a push to `refs/heads/main` or a manual dispatch selected on exact `refs/heads/main`.

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

#### Scenario: Manual non-main image dispatch

- **GIVEN** a user manually dispatches the image workflow on a ref other than
  exact `refs/heads/main`
- **WHEN** GitHub evaluates the workflow
- **THEN** no image build or publication job runs

### Requirement: Keep generic tests and checks out of automatic triggers

The repository SHALL NOT automatically run general, unit, static-check, or workflow-check jobs on feature pushes, pull requests, main pushes, or schedules.

#### Scenario: Feature push, pull request, or schedule

- **GIVEN** a feature push, pull request, main push for an auxiliary test
  workflow, or scheduled time occurs
- **WHEN** GitHub evaluates the repository workflows
- **THEN** no general, unit, static-check, or workflow-check job starts
- **AND** no image is built or published by those events

### Requirement: Keep other test workflows manual-only

Other test workflows SHALL remain manually invocable when needed or otherwise disabled; they SHALL NOT have push, pull request, or schedule triggers. `api-route-typecheck.yml`, `test-quarantine.yml`, and `release-acceptance.yml` SHALL be manual-dispatch-only.

#### Scenario: Task-specific manual test

- **GIVEN** a task requires a focused test or check
- **WHEN** an operator runs the relevant test command or explicitly enables
  and dispatches a manual-only workflow for that task
- **THEN** only that requested task-specific test runs
- **AND** it does not become a push, pull-request, main, or scheduled gate

### Requirement: Keep routine checks disabled outside task-specific runs

Repository settings SHALL keep routine checks disabled. If a task requires one, it SHALL be enabled and dispatched manually, then returned to disabled; only the fork image workflow SHALL remain active between such runs. Code changes SHALL be manually reviewed before merge.

#### Scenario: Routine check workflows return to disabled after a task

- **GIVEN** a task-specific routine check was manually enabled and dispatched
- **WHEN** the task run completes
- **THEN** routine check workflows are disabled again and only the fork image workflow remains active

### Requirement: Build once from the pinned official UI base on a native ARM64 runner

The image workflow SHALL use native `ubuntu-24.04-arm` and `docker/official-backend-overlay.Dockerfile` with base `ghcr.io/diegosouzapw/omniroute@sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c`. It SHALL compile backend routes once, preserve the official dashboard and runtime, and load one `linux/arm64` candidate.

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

### Requirement: Keep test gates and unsupported runner classes out of image builds

The image workflow and Docker builder SHALL NOT run unit, general, or static test gates. They SHALL NOT use QEMU, a paid larger runner, or a self-hosted runner.

#### Scenario: Main image build has no test gate

- **GIVEN** a canonical main commit is ready and no task-specific test workflow was requested
- **WHEN** the image workflow builds the candidate
- **THEN** it runs no unit, general, or static test gate and uses no QEMU, paid larger runner, or self-hosted runner

### Requirement: Set production build environment and heap only in the backend builder

After `npm ci` and before `npm run build:backend`, the Docker builder SHALL set `NODE_ENV=production` and `NODE_OPTIONS=--max-old-space-size=12288` in the builder stage only.

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

### Requirement: Keep builder overrides out of runtime and build correctly without cache

The runtime stage SHALL start from a fresh pinned-base stage and SHALL NOT copy builder-stage overrides into runtime configuration. Missing reusable ref-scoped BuildKit cache SHALL cause a clean build without changing correctness.

#### Scenario: Cache unavailable

- **GIVEN** no reusable ref-scoped BuildKit cache exists
- **WHEN** the main image workflow builds
- **THEN** it performs a clean build
- **AND** cache absence does not change build correctness

### Requirement: Start the candidate with Docker init before artifact checks

The workflow SHALL start and inspect its local candidate before GHCR authentication or publication. Candidate service startup SHALL enable Docker init to match production (`docker run --init`, equivalent to Docker API `HostConfig.Init=true`), forward signals, and reap child processes.

#### Scenario: Candidate process startup matches production

- **GIVEN** production Compose starts the service with `HostConfig.Init=true`
- **WHEN** the verifier starts the candidate service container
- **THEN** it enables Docker init (`docker run --init`)
- **AND** the app health and route checks run in that same initialized
  container
- **AND** browser smoke executes inside that container with `docker exec`
- **AND** no second app container is created for browser verification

### Requirement: Use the running candidate for browser smoke and isolate its data

Docker init SHALL apply only to candidate service startup; browser smoke SHALL use `docker exec` in the already-running candidate. The candidate SHALL mount `/app/data` as container-scoped tmpfs mode `1777`, preserve the image default `USER`, and SHALL NOT bind host temporary data.

#### Scenario: Candidate data is disposable and browser smoke reuses the running service

- **GIVEN** the artifact verifier has started the candidate service
- **WHEN** it runs browser smoke and mounts application data
- **THEN** browser smoke uses docker exec in that candidate and data remains container-scoped tmpfs mode 1777 without a host bind

### Requirement: Preserve verification errors while collecting cleanup failures

Verifier cleanup SHALL collect errors without replacing an earlier verification error. A verification error SHALL remain primary and SHALL be reported with every cleanup error.

#### Scenario: Verification and cleanup both fail

- **GIVEN** a primary artifact-verification error and one or more cleanup errors
- **WHEN** the verifier completes cleanup
- **THEN** it reports the primary verification error first
- **AND** it reports every cleanup error without replacing the primary error
- **AND** publication is blocked

### Requirement: Verify candidate ARM64 architecture and source, revision, and base identity

The verifier SHALL check ARM64 architecture and source/revision/base metadata on the actual container image.

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

### Requirement: Check runtime health and preserve the pinned official UI artifact

The verifier SHALL check native SQLite operation, configured Docker `HEALTHCHECK` status, direct UI root response, API behavior, and official UI preservation by comparing `BUILD_ID`, the full static tree, page manifest, and every non-API app-path entry with the pinned official image. The target SHALL preserve the pinned official UI and existing application manifests.

#### Scenario: Official UI assets and runtime checks match pinned image

- **GIVEN** the candidate is healthy and its UI and database checks pass
- **WHEN** the verifier compares build identity, static tree, page manifest, and non-API app paths
- **THEN** all checked artifacts match the pinned official image

### Requirement: Require the expected unauthenticated catalog response with disposable data

With `REQUIRE_API_KEY=true`, the direct Next UI listener SHALL return HTTP 401 with `error.code: "AUTH_002"` for unauthenticated `GET /api/v1/models`; client-API auth SHALL reject before the catalog handler. Smoke checks SHALL use disposable container data and SHALL NOT access production credentials or data.

#### Scenario: Unauthenticated catalog requests fail with the expected auth code

- **GIVEN** REQUIRE_API_KEY=true and a request has no client API key
- **WHEN** the direct UI listener handles GET /api/v1/models
- **THEN** it returns HTTP 401 with error.code AUTH_002 before catalog handling

### Requirement: Use direct UI and Docker health checks instead of the API proxy

The direct UI listener on port `20128` SHALL return HTTP 200 for `/` and health SHALL use Docker's configured `HEALTHCHECK`. The verifier SHALL NOT treat an API-proxy response on port `20129` as UI health.

#### Scenario: Candidate artifact check fails

- **GIVEN** any identity, native SQLite, health, route, UI comparison, or
  browser smoke fails
- **WHEN** the main image workflow evaluates the candidate
- **THEN** the workflow fails before GHCR login
- **AND** no tag is published or updated

### Requirement: Stop before registry authentication on failed artifact or cleanup checks

Any failed artifact check SHALL fail the workflow before registry authentication and SHALL publish no image. Cleanup failure after otherwise passing checks SHALL also fail before registry authentication.

#### Scenario: Cleanup fails after artifact checks pass

- **GIVEN** all artifact checks pass but a cleanup action fails
- **WHEN** the verifier completes
- **THEN** verification fails and reports the cleanup error
- **AND** GHCR authentication and publication do not occur

### Requirement: Report bounded sanitized catalog-auth diagnostics without sensitive output

A failed catalog-auth assertion SHALL report expected status/code, observed HTTP status, and only bounded sanitized `error.type` and `error.code` values from JSON. Diagnostics SHALL NOT include response bodies, headers, credentials, model data, or serialized errors, and SHALL NOT weaken the expected HTTP 401 / `AUTH_002` fixture.

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

### Requirement: Publish source-SHA and main tags only for a verified main candidate

After every artifact check passes, the canonical publisher SHALL publish `ghcr.io/etcetera-agency/omniroute` under full source-SHA and `:main` tags. Only a verified `refs/heads/main` run SHALL update `:main`; both tags SHALL refer to the verified candidate. The workflow SHALL NOT change package visibility or add signed-attestation infrastructure.

#### Scenario: Main publication succeeds

- **GIVEN** all container artifact checks pass for a main candidate
- **WHEN** the publisher completes
- **THEN** the full-SHA and `:main` tags resolve to the same manifest digest
- **AND** the run summary records digest, source, revision, base digest, and
  workflow run URL
- **AND** OCI labels match the summary

#### Scenario: First package publication

- **GIVEN** GHCR creates the fork package on its first image publication
- **WHEN** the workflow publishes the image
- **THEN** it leaves the default private visibility unchanged
- **AND** the owner changes package visibility to public in GitHub Packages
- **AND** an anonymous pull is verified before the server consumes the image

### Requirement: Use scoped publishing credentials and bind OCI labels to image identity

The publisher SHALL use only `GITHUB_TOKEN` scoped to `contents: read` and `packages: write`. It SHALL record the actual manifest digest, canonical source URL, source SHA, pinned base digest, and Actions run URL. OCI source, revision, and base-digest labels SHALL equal the canonical source URL, source SHA, and pinned base digest respectively. The manifest digest, not a label or mutable tag, SHALL identify the published artifact.

#### Scenario: Published manifest has matching OCI provenance

- **GIVEN** a main candidate passed artifact checks and the publisher received its manifest digest
- **WHEN** the publisher records image provenance
- **THEN** the OCI source, revision, and base-digest labels match the canonical source URL, source SHA, and pinned base digest respectively
- **AND** the recorded manifest digest identifies the published artifact independently of those labels

### Requirement: Write publication evidence as quoted data in the Actions summary

The workflow SHALL append source URL, full-SHA tag, manifest digest, pinned official base, verified OCI-label status, `:main` update status, and workflow run URL to `GITHUB_STEP_SUMMARY`. Dynamic values SHALL be quoted data arguments to a fixed single-quoted `printf` format so Markdown backticks stay literal and values cannot become shell commands.

#### Scenario: Publication summary preserves values

- **GIVEN** the main image was published and the public summary values are set
- **WHEN** the workflow writes the Actions summary
- **THEN** each source, tag, digest, base, and run URL appears unchanged
- **AND** Markdown backticks appear as literal characters
- **AND** no command substitution is executed for a dynamic value

### Requirement: Derive the browser runtime from verified runtime and shared dependencies

The main workflow SHALL build `runtime-web` from verified `runtime`. Lockfile installation SHALL use shared `backend-dependencies` with `backend-builder` derived from it, so source compiles once and runtime-web reuses pinned Playwright packages. Selecting `prebuilt-backend` SHALL NOT force backend compilation merely to provide browser packages.

#### Scenario: Prebuilt backend reuses browser dependencies without compilation

- **GIVEN** prebuilt-backend is selected and browser packages are available from backend-dependencies
- **WHEN** runtime-web is built
- **THEN** backend-builder does not compile solely to provide browser packages

### Requirement: Install lockfile-resolved Playwright and the required browser runtime

The `runtime-web` target SHALL copy only lockfile-resolved Playwright packages from `backend-dependencies`, install Chromium and required OS libraries with Playwright CLI `--with-deps`, and install Xvfb and Xauth. It SHALL set `PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright` and make that cache available to the default `node` user.

#### Scenario: Browser runtime is missing or cannot launch

- **GIVEN** the candidate lacks required browser packages, binaries, or Xvfb
- **OR** non-root Chromium cannot launch or close successfully
- **WHEN** the artifact verifier checks the browser runtime
- **THEN** verification fails before GHCR authentication
- **AND** no image tag is published or updated

### Requirement: Run the permission checker under Xvfb with the restored official command

The runtime-web entrypoint SHALL run `/app/check-permissions.sh` through `xvfb-run -a -s '-screen 0 1920x1080x24 -nolisten tcp'`. Since an ENTRYPOINT override clears the base CMD, runtime-web SHALL declare `CMD ["node", "dev/run-standalone.mjs"]` in the current stage. The pinned-base Docker HEALTHCHECK SHALL remain unchanged.

#### Scenario: Browser runtime restores the official startup contract

- **GIVEN** runtime-web is selected from the pinned base
- **WHEN** the image configuration is assembled
- **THEN** the permission checker runs under Xvfb with the official default command and unchanged healthcheck

### Requirement: Inspect browser image identity without exposing other configuration

Before candidate startup and registry authentication, verification SHALL require image `User` to be `node`, `Entrypoint` to be the exact Xvfb permission-check command and arguments specified above, and `Cmd` to be `["node", "dev/run-standalone.mjs"]`. Missing or different values SHALL fail before container startup. Diagnostics SHALL report only expected and observed User, Entrypoint, and Cmd fields, not environment variables or other image config.

#### Scenario: Candidate command configuration is missing or incorrect

- **GIVEN** the candidate image's `User`, `Entrypoint`, or `Cmd` differs from
  the required runtime-web configuration
- **WHEN** the verifier performs image-config preflight
- **THEN** it fails before starting the candidate container
- **AND** it reports only expected and observed `User`, `Entrypoint`, and
  `Cmd` values
- **AND** GHCR authentication and publication do not occur

### Requirement: Run isolated non-root Chromium smoke before publishing

After image-config preflight, candidate verification SHALL launch Chromium through Playwright with `headless: false` as the default non-root user, open only `about:blank`, and close cleanly under Xvfb without external requests. Any failure SHALL block publication.

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

### Requirement: Dispatch deployment only after verified current-main publication

Production Compose SHALL consume the fork's published ARM64 image without server source builds. The sole image workflow SHALL automatically dispatch deployment only after publishing a verified main candidate by immutable digest, successfully updating main, and using exact canonical main as source ref. Deployment SHALL use only successful publisher digest output, source SHA, run ID, and attempt; mutable main SHALL NOT identify the deployed image.

#### Scenario: Current-main publication deploys automatically

- **GIVEN** the verified publisher succeeds on canonical main and updates
  main
- **AND** runner and host freshness checks match the source SHA
- **WHEN** the publisher completes
- **THEN** production receives the exact published image digest
- **AND** the host runs only the app service without a build or Redis restart
- **AND** successful migrations and acceptance produce SUCCEEDED

### Requirement: Recheck main freshness and protect the production SSH handoff

The runner SHALL recheck source SHA against canonical main before SSH; the host SHALL check again after pull and lock, before stopping the app. Stale source SHALL persist `SKIPPED_STALE` and cause no app or DB mutation. The production Environment SHALL accept main only with no reviewer pause. SSH SHALL use a pinned host key, dedicated forced-command account, fixed root-owned helper, and validated protocol from `main-image-ssh-cd`.

#### Scenario: Publication, freshness, or host preflight fails

- **GIVEN** publication is unsuccessful, main was not updated, the source is
  stale, SSH is invalid, image identity mismatches, or fixed Compose
  preflight fails
- **WHEN** the deploy workflow or host evaluates the request
- **THEN** it records skip/failure before app/DB mutation
- **AND** the currently running app and database remain unchanged

### Requirement: Persist effective Compose inputs as durable root-owned production files

The host SHALL copy current production base, candidate, browser, and image-only Compose inputs under `/etc/omniroute-deploy/compose/` and verify they render the current project. These copies SHALL be authoritative for deploy and rollback; dated diagnostics paths SHALL NOT be runtime dependencies.

#### Scenario: Durable Compose inputs render the current project

- **GIVEN** the host copied current production Compose inputs into the protected directory
- **WHEN** preflight renders the root-owned project
- **THEN** it matches the running production project without dated diagnostics

### Requirement: Run only the verified digest for the app and preserve Redis identity

The host SHALL verify ARM64/provenance labels and current app/Redis state, change only the app service, and run the exact digest with no-build, no-deps, and pull-never behavior. Redis SHALL remain unchanged.

#### Scenario: Only the app service changes to the requested digest

- **GIVEN** the requested image digest passed host verification and Redis is healthy
- **WHEN** the candidate is started
- **THEN** only the app service uses the requested digest and Redis identity remains unchanged

### Requirement: Snapshot SQLite and prior image state before candidate startup migrations

Before candidate startup, the host SHALL stop the app, create and validate a fresh root-only SQLite online backup, record exact prior image/config and DB metadata, then allow normal candidate startup migrations to run.

#### Scenario: Protected snapshot precedes candidate startup

- **GIVEN** the app is serving production and a verified backup is ready
- **WHEN** the deployment starts the candidate
- **THEN** the app was stopped and prior image, config, and database metadata were recorded before migration code ran

### Requirement: Accept the candidate only after bounded health, route, database, and Redis checks

Acceptance SHALL require configured Docker health, direct UI root and public dashboard HTTP 200, unauthenticated `GET /api/v1/models` HTTP 401 with `AUTH_002`, SQLite integrity, no foreign-key failures, exact numeric migration source-ID coverage, and unchanged Redis identity. Each check SHALL have a finite bound from health timing, startup allowance, and local route checks.

#### Scenario: Candidate migrations or acceptance fail

- **GIVEN** the app has been quiesced and a fresh valid backup exists
- **AND** candidate_may_mutate is true
- **WHEN** candidate startup or any acceptance check fails
- **THEN** the host restores the exact pre-deploy database and prior image
- **AND** it verifies the restored app before returning terminal failure
- **AND** it retains the original backup and failed-candidate diagnostic copy

### Requirement: Run private acceptance probes through the app and public dashboard probe on host

Private UI/API checks SHALL run through the app container Node runtime against loopback port 20128 for candidate and prior image, emitting only sanitized status/error codes. The public dashboard check SHALL run from host. Production gateway binding on port 20129 SHALL remain unchanged.

#### Scenario: Private and public probes use their assigned contexts

- **GIVEN** candidate and prior images are under acceptance and the public dashboard is reachable from the host
- **WHEN** acceptance probes run
- **THEN** private UI/API checks use app-container loopback and the public dashboard check uses the host

### Requirement: Restore the online backup and exact prior image after acceptance failure

On post-migration failure, the host SHALL preserve a candidate DB diagnostic copy and restore the fresh pre-deploy snapshot. Before prior image startup, restored DB file SHA-256 SHALL equal the protected online-backup hash in the transaction manifest, not the pre-backup live DB hash. The host SHALL restore the exact prior image and verify old health and DB state.

#### Scenario: Rollback restores the protected online backup by exact hash

- **GIVEN** candidate acceptance fails after migration and the protected backup has a recorded SHA-256
- **WHEN** the host restores the database before restarting the prior image
- **THEN** the restored database hash equals the online-backup hash and the prior image is restored

### Requirement: Preserve recovery files and leave app stopped if restore cannot be verified

A failed restore SHALL leave the app stopped and retain all recovery files. With no confirmed maintenance proxy, requests accepted after candidate startup MAY be lost if the snapshot is restored after a later acceptance failure.

#### Scenario: Unverified restoration leaves recovery state intact

- **GIVEN** restoring or validating the prior database or image fails
- **WHEN** rollback finishes
- **THEN** the app remains stopped and recovery files remain available

### Requirement: Reattach production transactions across runner disconnects and reruns

The host transaction SHALL survive runner/SSH disconnect. A nonblocking server lock and static non-canceling deployment concurrency group SHALL prevent overlapping replacements. Runner and host SHALL record status by run ID plus attempt; same-tuple retries reattach, and a GitHub rerun uses a new attempt.

#### Scenario: Runner disconnects or a rerun arrives

- **GIVEN** a durable transaction is running or has reached a terminal state
- **WHEN** SSH disconnects or the same tuple is retried
- **THEN** the server transaction continues and the retry reattaches to status
- **WHEN** GitHub starts a new run attempt for the same run ID
- **THEN** it receives a distinct transaction key and cannot overlap the
  current server transaction

### Requirement: Require focused checks and an isolated rehearsal before first production deploy

Focused checks and a root-admin isolated Compose/DB rehearsal SHALL precede the first production run. The workflow SHALL add no general automatic test gate.

#### Scenario: First production deployment follows isolated rehearsal

- **GIVEN** the automated deployment has not yet run against production
- **WHEN** the release gate is reviewed
- **THEN** focused checks and a root-admin isolated Compose/DB rehearsal are complete
