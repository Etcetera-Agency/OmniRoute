# Change: Build and Pull OmniRoute Overlay Image from GitHub

**Status:** Approved. Main image publication remains gated on successful
native build and artifact verification.

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
prediction is not runtime proof. Keep the auth fixture and 401 assertion
unchanged. Improve only the failure message to include observed HTTP status
and bounded, sanitized `error.type` / `error.code`; never log response body,
headers, credentials, or model data. The next main run remains required to
prove the actual response and pass all artifact checks.

## What Changes

- Keep one GitHub Actions workflow for the fork image. It runs on push to
  `refs/heads/main` and manual dispatch only when the selected ref is exactly
  `refs/heads/main`. Feature pushes, pull requests, and schedules do not run
  automatic unit, static, or general check jobs. Tests may be run manually for
  a specific task; they are not scheduled or attached to GitHub events.
- On native `ubuntu-24.04-arm`, build the existing
  `docker/official-backend-overlay.Dockerfile` from the pinned official image
  `ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`.
  Install dependencies with `npm ci`, then set builder-stage
  `NODE_ENV=production` and `NODE_OPTIONS=--max-old-space-size=12288` before
  `npm run build:backend`; keep both settings out of the runtime stage.
  Compile backend routes once, preserve the official UI, and load the
  candidate locally. Do not run a unit-test gate as part of the image workflow.
- Before GHCR authentication/publication, verify the built container artifact:
  ARM64 architecture and source/base metadata, native SQLite, the configured
  Docker `HEALTHCHECK`, direct UI root response, API behavior, and byte-level
  official UI parity. The UI root on `127.0.0.1:20128/` must return HTTP 200;
  the direct Next UI listener (`20128`) must return HTTP 401 with
  `error.code: "invalid_api_key"` for unauthenticated
  `GET /api/v1/models`. On failure, report expected status/code plus observed
  HTTP status and bounded, sanitized `error.type` / `error.code` only; never
  log response body, headers, credentials, or model data. Any failed artifact
  check stops publication.
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
  artifact identity.
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
  runtime verification, and GHCR publication; triggers are main push and
  manual exact-main dispatch.
- `scripts/ci/verify-official-overlay-image.mjs` and
  `tests/unit/build/verify-official-overlay-image.test.mjs`: reusable local
  artifact verifier, container-scoped test data, cleanup error reporting,
  safe catalog-auth assertion diagnostics, and manually invoked focused tests.
- `docker/official-backend-overlay.Dockerfile` and `.dockerignore`: single
  backend-only compile using the pinned official base, production `NODE_ENV`
  after dependency installation, and explicit 12288-MiB builder-stage Node
  heap, without an automatic unit-test gate.
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
development warnings. The exact minified callsite was not isolated. Set
builder-only `NODE_ENV=production` after
`npm ci` and before `npm run build:backend`. The next main run must validate
this correction and complete container checks before publication. The third
main run `37126849223` completed the native ARM64 candidate build and backend
compile after PR #13, then failed in verifier cleanup with `EACCES` unlinking
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
- [ ] Production deployment
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
