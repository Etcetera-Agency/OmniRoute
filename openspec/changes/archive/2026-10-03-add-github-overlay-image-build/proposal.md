# Change: Build and Pull OmniRoute Overlay Image from GitHub

**Status:** Complete, ready to archive. Native artifact verification,
publication, anonymous pull, app-only server cutover, health/browser/database
acceptance, and authorized builder-cache cleanup passed on 2026-10-03. Durable
sanitized evidence is recorded in `/tmp/hermes-omniroute-deploy-acceptance-9e6e053e-20261003.md`
and `/opt/apps/omniroute-deploy-diagnostics/main-image-9e6e053e-precutover-20261003T182221Z/deploy-acceptance-cache.txt`.
No database migration ran. Future base provenance, build-context optimization,
and production CD remain in repo-level `openspec/TODO.md`.

## Why

The full dashboard build repeatedly exhausted memory on the deployment server.
The approved runtime keeps the upstream dashboard and overlays the fork's
backend API. GitHub should produce that ARM64 image from the reviewed `main`
revision, verify the actual container artifact, and publish only a candidate
that passes those runtime checks. The server should pull the published image
instead of compiling source. First main build failed during
`npm run build:backend` at an effective V8 old-space limit near 1043 MiB; PR
#12 added builder-only `NODE_OPTIONS=--max-old-space-size=12288`. The next main
run passed that heap failure but failed while prerendering `/_global-error`
with a null React `use` error. Read-only diagnosis found that the Dockerfile
set `NODE_ENV=development` for `npm ci` and left it set during compilation;
the installed Next CLI preserved it, and build logs showed React development
warnings. The exact minified callsite was not isolated. Set builder-only
`NODE_ENV=production` after `npm ci` and before
`npm run build:backend`; keep the runtime stage unchanged. The next main build
is the acceptance test, not proof in advance that the diagnosis covers the
exact internal callsite. PR #13 merged this correction. The third main run
`37126849223` successfully built and compiled the native ARM64 candidate, then
failed in verification cleanup with `EACCES` unlinking a cache file from
host-bound `/app/data`. The verifier used a host temporary data directory;
container default user `node` (UID 1000) created the file, while the GitHub
runner user (UID 1001) could not unlink it. Cleanup in `finally` may also mask
an earlier verification error, so the log does not prove earlier checks
passed. Use container-scoped tmpfs for `/app/data` with mode `1777`, preserve
the image's default user, and collect cleanup errors without replacing the
primary verification error. The next main run must pass full candidate
verification before publication.

The fourth main run `37129219486` built the native candidate in 8m28, then
failed the direct `/api/v1/models` assertion. It did not log actual HTTP
status, `error.type`, `error.code`, or body; no response is inferred. A fresh
read-only source/configuration diagnosis predicts this disposable fixture
should return HTTP 401 with `invalid_api_key`: `INITIAL_PASSWORD` is set,
`requireLogin` is true, and the model-auth opt-out is absent. That source
prediction was not runtime proof and missed client-API classification; it is
superseded by the middleware diagnosis below. Keep the auth fixture and 401
assertion. Improve only the failure message to include observed HTTP status
and bounded, sanitized `error.type` / `error.code`; never log response body,
headers, credentials, or model data. The next main run remains required to
prove the actual response and pass all artifact checks.

The fifth main run `37132155004` completed the native candidate image build but
the verifier observed HTTP 401 with `error.code: "AUTH_002"` and no
`error.type`, instead of expected `invalid_api_key`; GHCR login and publication
were skipped. Read-only diagnosis traced this to the intended client-API auth
middleware path: classification routes the request through the proxy auth
pipeline, which rejects it before the catalog handler and emits `AUTH_002`.
The earlier source prediction missed this middleware path. With
`REQUIRE_API_KEY=true`, update the fixture assertion to require the exact
HTTP 401 / `AUTH_002` envelope; do not accept arbitrary 401 responses or the
unreached handler's `invalid_api_key` code.

The original final Actions summary used backticks inside double-quoted `echo`
strings. Bash treated them as command substitutions, removing source, tag,
digest, base, and run-URL values even though publication could already succeed.
The workflow now uses single-quoted `printf` formats and separately quoted
value args so Markdown backticks stay literal; a representative manual shell
probe confirms every value is preserved.

The sixth main run `37138784470` built the backend and Playwright Chromium, but
the candidate's Docker healthcheck became unhealthy with
`172.17.0.3: fetch failed`; GHCR login and publication were skipped. API,
browser, and UI checks were not proven, and the run logs do not record the
container command configuration. Static inspection found a definite image
configuration defect: `runtime-web` replaces `ENTRYPOINT` without declaring a
stage-local `CMD`, so Docker clears the base image's `CMD`. Declare the exact
official command `CMD ["node", "dev/run-standalone.mjs"]` in `runtime-web`.
Before starting the candidate, inspect and require the expected `USER`, Xvfb
`ENTRYPOINT`, and exact `CMD`; report only these allowlisted configuration
fields on mismatch. The missing command is a confirmed defect, but the
available run output does not establish that it caused the health failure.
Focused local verifier tests pass 9/9, with scoped lint, formatting, diff
checks, Code Simplifier, and independent review passing. A corrected launcher
rehearsal using the exact CI fixture without Docker init stayed running but
unhealthy; auth/browser checks did not run. A new native main run must prove
corrected image configuration, healthy startup, browser smoke, and all other
artifact checks before publication.

Read-only production configuration confirms `HostConfig.Init=true`, with
`docker-init` as PID 1. In the same old-backend disposable verifier fixture,
only `--init` changed: without it, Xvfb readiness stalled before Node; with it,
the `node` user process started and Docker reported healthy. Direct UI root
returned HTTP 200 after redirect; `GET /api/v1/models` returned exactly HTTP
401 `AUTH_002`; headed Chromium opened and closed `about:blank` under Xvfb as
UID 1000. This differential confirms init behavior for that fixture, not the
new `runtime-web` image or main artifact gate. Start only the candidate service
container with Docker init enabled; keep final native-image, browser, and
production acceptance gates open.

## Acceptance update — 2026-10-03

Main Actions run
[`37142905181`](https://github.com/Etcetera-Agency/OmniRoute/actions/runs/37142905181)
passed the native `linux/arm64` candidate artifact gate and published source
`9e6e053efe56fc13ea6d9b106feb18503a9a70a7` from
`https://github.com/Etcetera-Agency/OmniRoute` to
`ghcr.io/etcetera-agency/omniroute`. Both the full-SHA tag and `:main` resolve
to manifest digest
`sha256:671177c97f894c2bebb2da6cc9dadc0b89fc65bc031eeb044862276eb2322c66`;
the image records pinned base digest
`sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`.
The run passed ARM64, native SQLite 3.53.4, configured healthcheck, direct UI
root HTTP 200, unauthenticated direct UI API HTTP 401 `AUTH_002`, non-root
headed Chromium under Xvfb opening and closing `about:blank`, and full official
UI parity. Workflow summary and registry digest agree.

This closes native artifact verification, publication, public image pull, and
operator-run server acceptance. The package is public, and organization
settings were restored after temporarily allowing public package creation.
Credentialless manifest requests for `:main` and the exact digest returned
HTTP 200 with matching digest; the full anonymous Docker pull matched ARM64
and OCI source/revision/base labels. Server acceptance passed on the digest:
app health, SQLite 3.53.4 integrity and foreign keys, migration table state
196 (193 numeric versions, maximum 196, and three legacy rows), empty
token/request-cost ledgers, UI/API/dashboard responses, and headed Chromium as
UID 1000. No database migration ran. The old browser image, Redis identity,
and fresh backup remain preserved. Cache cleanup removed only the dedicated
builder and unused BuildKit cache; measured root-filesystem space gain was
73,019,129,856 bytes. Evidence paths are listed in the status and task 4.12.
Publishing `:main` alone does not deploy the Compose service.

Production currently runs a separate browser-capable layer,
`omniroute:55f40468-official-overlay-web-browser-20261003`, through the third
Compose browser override. It provides Chromium, Xvfb, and lockfile-resolved
Playwright packages and wraps the permission-check entrypoint with `xvfb-run`.
A plain backend overlay would remove these providers. Publish a `runtime-web`
target derived from the official-overlay runtime: share a dependency stage
with the backend compiler, copy lockfile-resolved Playwright packages, install
Chromium and OS dependencies, and preserve the official UI and permission
check. Redeclare the exact official `CMD` in the final `runtime-web` stage
because that stage replaces `ENTRYPOINT`; preserve the official healthcheck.
Preflight the resulting image's `USER`, `ENTRYPOINT`, and `CMD` before starting
the candidate. The image workflow must verify a real non-root, headed Chromium
launch under Xvfb on `about:blank` before publishing. The server must retain
the current browser-capable rollback image until the new main image passes
this acceptance.

## What Changes

- Keep one GitHub Actions workflow for the fork image. It runs on push to
  `refs/heads/main` and manual dispatch only when the selected ref is exactly
  `refs/heads/main`. Feature pushes, pull requests, and schedules do not run
  automatic unit, static, or general check jobs. Tests may be run manually for
  a specific task; they are not scheduled or attached to GitHub events.
- On native `ubuntu-24.04-arm`, build the existing
  `docker/official-backend-overlay.Dockerfile` from the pinned official image
  `ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`.
  Factor lockfile-resolved dependencies into a shared stage; keep
  `backend-builder` as its child and compile once. Build the `runtime-web`
  target from `runtime`; install the same locked Playwright packages and
  Chromium runtime without making prebuilt-backend packaging compile backend
  sources. Install dependencies with `npm ci`, then set builder-stage
  `NODE_ENV=production` and `NODE_OPTIONS=--max-old-space-size=12288` before
  `npm run build:backend`; keep both settings out of the runtime stage.
  Compile backend routes once, preserve the official UI, and load the
  candidate locally. Do not run a unit-test gate as part of the image workflow.
- Before GHCR authentication/publication, verify the built container artifact:
  ARM64 architecture and source/base metadata, native SQLite, the configured
  Docker `HEALTHCHECK`, direct UI root response, API behavior, and byte-level
  official UI parity. The UI root on `127.0.0.1:20128/` must return HTTP 200;
  the direct Next UI listener (`20128`) must return HTTP 401 with
  `error.code: "AUTH_002"` for unauthenticated
  `GET /api/v1/models` when `REQUIRE_API_KEY=true`. On failure, report expected
  status/code plus observed
  HTTP status and bounded, sanitized `error.type` / `error.code` only; never
  log response body, headers, credentials, or model data. Any failed artifact
  check stops publication.
- In the running candidate, launch Chromium as the image's default non-root
  user through Playwright with `headless: false` under Xvfb, load only
  `about:blank`, and close cleanly without external requests. Keep the pinned
  official UI/manifests and pinned-base `HEALTHCHECK`; wrap the existing
  permission-check entrypoint with the approved `xvfb-run` invocation and set
  `PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright`. Explicitly
  redeclare the official `CMD ["node", "dev/run-standalone.mjs"]` in
  `runtime-web`, preflight `USER`, `ENTRYPOINT`, and `CMD`, and start the
  candidate application container with Docker init enabled (`docker run
--init`, equivalent to `HostConfig.Init=true`). Apply init only to service
  startup; browser checks execute inside the started container.
- Mount candidate `/app/data` as a container-scoped tmpfs with mode `1777`;
  keep the image's default `USER` and do not bind host temporary data into the
  candidate. Collect cleanup errors without replacing an earlier verification
  error. If verification passes but cleanup fails, fail the verifier and block
  publication; if both fail, report the primary verification error and all
  cleanup errors.
- Publish the already verified image to
  `ghcr.io/etcetera-agency/omniroute` under its full source SHA and `:main`.
  Only the main workflow writes `:main`. Record the manifest digest, source
  URL/SHA, pinned base digest, and Actions run URL; treat the digest as the
  artifact identity. Render the step summary with single-quoted `printf`
  formats and separately quoted values; preserve literal Markdown backticks
  and ensure source, tags, digest, base, and run URL appear intact.
- Configure the server to pull `ghcr.io/etcetera-agency/omniroute:main`,
  verify its digest, and start with `docker compose up -d --no-build`. Keep
  deployment operator-run and retain a prior-digest rollback procedure.
- Use only `GITHUB_TOKEN` for publication. Do not add Docker Hub credentials,
  upstream write access, or production deployment secrets. The workflow
  leaves package visibility unchanged. After first successful main
  publication, the owner changes the new GHCR package from private to public
  and verifies anonymous pull access.

## Impact

### Affected Specifications

- New capability: `github-overlay-image-build`.

### Affected Code

- `.github/workflows/omni-overlay-image.yml`: only automatic fork image build,
  `runtime-web` verification, and GHCR publication; triggers are main push and
  manual exact-main dispatch. Use safe `printf` formatting for published-image
  summary evidence so shell command substitution cannot erase it.
- `scripts/ci/verify-official-overlay-image.mjs` and
  `tests/unit/build/verify-official-overlay-image.test.mjs`: reusable local
  artifact verifier, container-scoped test data, cleanup error reporting,
  safe catalog-auth assertion diagnostics, image `USER`/`ENTRYPOINT`/`CMD`
  preflight, Docker-init candidate startup, non-root Playwright browser smoke,
  and manually invoked focused tests.
- `docker/official-backend-overlay.Dockerfile` and `.dockerignore`: shared
  lockfile-dependency stage, one source backend compile, pinned official
  runtime, and browser-capable `runtime-web` target with Chromium/Xvfb. Keep
  production `NODE_ENV` and 12288-MiB Node heap in the backend builder, and
  explicitly set the official CMD in `runtime-web`, without an automatic
  unit-test gate.
- `docker-compose.yml` and `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md`: pull the
  fork `:main` image and document digest verification, no-build start, health
  checks, and rollback.
- GitHub Actions settings and the server playbook: keep routine test/check
  workflows disabled; preserve only the fork main-image workflow. Updating the
  playbook is required so a later upstream synchronization does not turn
  automatic checks back on.

### User Impact

No automatic unit/static test suite runs on feature pushes, PRs, main pushes,
or a schedule. The only automatic project workflow builds the main image and
verifies the actual candidate container before publication. Code changes are
reviewed manually; tests can be invoked for a specific task. PR #11 merged at
`3a484460`; first main run `37124029642` failed at an effective V8 old-space
limit near 1043 MiB. A prior successful remote compile of the same backend
used a 12-GiB heap with about 15.72 GB measured peak; the public ARM64 runner
advertises 16 GB. PR #12 raised the builder-only heap to 12288 MiB. Second main
run `37125217705` then failed during `/_global-error` prerender with
`TypeError: Cannot read properties of null (reading 'use')`; the worker exited
1 at about 214.4s, and the heap-limit failure did not recur. Read-only
diagnosis found the Dockerfile's `NODE_ENV=development` setting for `npm ci`
remained active through backend compilation; build logs showed React
development warnings. The exact minified callsite was not isolated. PR #13 set
builder-only `NODE_ENV=production` after `npm ci` and before
`npm run build:backend`; main run `37126849223` completed backend compilation
with that correction, then failed in verifier cleanup with `EACCES` unlinking
`/tmp/omni-overlay-data-uR7ulC/cache/openrouter-provider-stats.json`. A read-only
diagnosis traced the cleanup failure to host-bound `/app/data`: container user
`node` (UID 1000) created the cache file and runner user UID 1001 could not
unlink it. The `finally` cleanup may mask a primary verifier error; no earlier
error appeared in the available output, so prior checks cannot be assumed to
have passed. Use a container-scoped `/app/data` tmpfs in mode `1777`, preserve
the image's default user, and report cleanup errors alongside any primary
verification error. A cleanup-only failure must still fail verification. No
GHCR login or publication occurred. The next main run must complete every
artifact check before publication. The server then pulls the main-built image
instead of building on the VPS.

Public runner hardware details do not guarantee this compiler fits. Preserve
actual run evidence and do not add speculative resource caps.

### API Changes

None. This packages the existing backend overlay.

### Migration Required

- [ ] Database migration
- [ ] API version bump
- [x] Production deployment
- [x] GitHub image build and container artifact verification before publication

## Security and Registry Access

The image publisher has `contents: read` and `packages: write`; the token is
used only after artifact verification. The workflow does not execute a
pull-request job, and checkout credentials are not persisted. OCI source,
revision, and base-digest labels plus registry digest and Actions run URL
provide traceability; no signed-attestation service is added. The first GHCR
publication defaults private. After it succeeds, the owner changes package
visibility to public in GitHub Packages. The workflow does not change package
settings; anonymous pull must succeed before server use.

## Risks and Open Gates

- PR #11 was reviewed and merged at `3a484460`. The first main image run,
  `37124029642`, failed after 4m17 in `npm run build:backend`: V8 reported
  repeated ineffective mark-compacts and allocation failure at an effective
  old-space limit of about 1043 MiB. No image was published. At that time, the
  Dockerfile had no `NODE_OPTIONS`; build helper code supplies 8192 only when
  no option is inherited, so the official base's inherited setting prevailed.
- Set `NODE_OPTIONS=--max-old-space-size=12288` in the builder stage before
  `npm run build:backend`; do not apply it to the runtime stage or change shared
  build helpers. This matches a prior successful remote compile of the same
  backend at 12 GiB heap (about 15.72 GB measured peak) against the public
  runner's stated 16 GB. The failed runner's RSS/cgroup peak and Node version
  were not measured. PR #12 merged this builder-only correction; the second
  main run showed that this setting alone did not complete the build.
- Second main run `37125217705` passed the prior heap failure but failed while
  prerendering `/_global-error`: `TypeError: Cannot read properties of null
(reading 'use')`, then `Export encountered an error on /_global-error/page`;
  the Next worker exited 1 at about 214.4s. It did not log in to GHCR or
  publish an image. Read-only diagnosis found the Dockerfile's
  `NODE_ENV=development` setting for `npm ci` persisted through backend
  compilation; the installed Next CLI preserved it, and the build log showed
  React development warnings. Diagnosis did not isolate the exact minified
  callsite.
  After `npm ci`, set builder-only `NODE_ENV=production` before
  `npm run build:backend`; keep it out of the fresh runtime stage. The next
  main build and artifact verification remain the acceptance gate.
- Third main run `37126849223` completed the native ARM64 candidate build and
  backend compilation in about 9 minutes after PR #13, then failed in verifier
  cleanup with `EACCES` unlinking
  `/tmp/omni-overlay-data-uR7ulC/cache/openrouter-provider-stats.json`. The
  candidate's `/app/data` was host-bound; container UID 1000 created the file,
  while runner UID 1001 could not unlink it. The available log does not show
  whether an earlier verifier error occurred because `finally` cleanup can
  mask it. No GHCR login or publication occurred. Replace the host data bind
  with a container-scoped `/app/data` tmpfs in mode `1777`, keep the image's
  default user, and preserve primary verification errors while reporting every
  cleanup error. Fail publication even when verification succeeds but cleanup
  fails. Full artifact acceptance remains open.
- Verify public package access, anonymous server pull, digest, container
  health, native SQLite, dashboard/API behavior, and rollback before closing
  the production image transition.
- Verify upstream image provenance and rerun artifact compatibility whenever
  the official base digest changes.
- Keep unrelated routine-check workflows disabled after any upstream sync;
  preserve only the fork image workflow.
