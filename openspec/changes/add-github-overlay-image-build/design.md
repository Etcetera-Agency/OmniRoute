# Design: Main-only GitHub overlay image

## Decision

GitHub automation in this project does not run general, unit, or static-check
tests on feature pushes, pull requests, main pushes, or a schedule. Tests are
invoked manually for a specific task. Keep existing routine-check workflows
disabled; after any upstream synchronization, keep them disabled and preserve
only the fork image workflow as an active GitHub workflow.

The sole active workflow builds the fork's ARM64 overlay image on a push to
`refs/heads/main` and on manual dispatch only when the selected ref is exactly
`refs/heads/main`. It builds and verifies the actual image artifact, then
publishes the exact verified candidate. A feature push, pull request, schedule,
or manual dispatch on any other ref runs no workflow checks and publishes no
image.

The image reuses `docker/official-backend-overlay.Dockerfile` and its pinned
official UI/backend base:

```text
ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96
```

Build on `ubuntu-24.04-arm` for `linux/arm64`; do not use QEMU or paid/self-
hosted runners. Compile backend routes once and retain the official UI,
static assets, and runtime configuration. Do not run unit or static test
gates in the image workflow or Docker builder. Load one candidate locally and
verify that actual container before GHCR authentication or publication.

The backend builder installs dependencies first, then compiles with
`NODE_ENV=production` and `NODE_OPTIONS=--max-old-space-size=12288`. Setting
`NODE_ENV` after `npm ci` lets dependency installation use the Dockerfile's
existing development setting, then switches Next to production mode for the
backend build. Both overrides remain in the builder stage; the final image
starts from a fresh pinned-base stage.

## Workflow pseudocode

```text
on push where ref == refs/heads/main,
or workflow_dispatch where ref == refs/heads/main:
    grant the image job contents:read
    checkout the triggering main commit
    build one linux/arm64 candidate from the pinned official base
    in the backend builder stage:
        RUN npm ci
        ENV NODE_ENV=production
        ENV NODE_OPTIONS=--max-old-space-size=12288
        RUN npm run build:backend
    do not export either build environment setting to the runtime stage
    compile backend routes exactly once; do not run unit-test commands
    load the candidate locally
    inspect candidate architecture and OCI source/revision/base labels
    start candidate with container-scoped tmpfs at /app/data, mode 1777
    preserve image's default USER; do not bind host temporary data
    verify configured Docker HEALTHCHECK reports healthy
    verify native SQLite operation
    verify direct Next UI listener behavior:
        GET http://127.0.0.1:20128/ expects HTTP 200
        GET http://127.0.0.1:20128/api/v1/models without credentials
        expect HTTP 401 and error.code == "invalid_api_key"
        on mismatch, report expected status/code and observed HTTP status
        plus bounded sanitized error.type/error.code fields only
        never log response body, headers, credentials, or model data
    compare BUILD_ID, complete static tree, page manifest, and every
        non-API app-path entry with the pinned official image
    capture any verification error as the primary error
    run all cleanup actions, collecting every cleanup error
    if primary verification error or cleanup errors exist:
        report primary verification error first, plus every cleanup error
        fail verification; do not authenticate or publish
    login to ghcr.io using GITHUB_TOKEN
    publish tested image as ghcr.io/etcetera-agency/omniroute:<full-SHA>
    publish the same manifest as ghcr.io/etcetera-agency/omniroute:main
    record manifest digest, source URL/SHA, base digest, and Actions run URL

on feature push, pull_request, or schedule:
    run no automated project test/check workflow

on workflow_dispatch for any ref other than exact main:
    run no image build, test/check workflow, or publication
```

The image workflow must verify both canonical repository and exact main ref.
Only a successful main image workflow writes the mutable `:main` alias. The
full-SHA tag is a locator, not an immutability guarantee; the registry
manifest digest is the artifact identity. Apply OCI source, revision, and
official-base-digest labels and include them and the digest in the Actions
summary. Do not add signed-attestation infrastructure.

Grant the image workflow only `contents: read` and `packages: write`; use
`GITHUB_TOKEN` only after all artifact checks pass, disable checkout credential
persistence, and add no Docker Hub, upstream write, server pull, or production
deployment secrets. Keep BuildKit GHA cache best-effort, ref-scoped, and
`mode=min`; cache misses must produce a clean build. Do not export a large
compiler cache artifact.

## Container artifact acceptance

The main image workflow verifies the built candidate itself before registry
authentication:

1. Architecture is `linux/arm64`; OCI source, full revision, and base digest
   match the triggering commit and pinned base.
2. The application starts with disposable container-scoped `/app/data` tmpfs;
   the configured Docker `HEALTHCHECK` reports healthy and a native SQLite
   operation succeeds.
3. Direct Next UI listener `20128` returns HTTP 200 for `/` and HTTP 401 with
   `error.code: "invalid_api_key"` for unauthenticated `GET /api/v1/models`.
   Keep these UI checks separate from the API listener proxy on `20129`; a 404
   from probing a health path on that proxy is not a failed UI health check.
4. Against the pinned official image, `BUILD_ID`, full static tree, page
   manifest, and every non-API app-path entry match exactly.

Any failed artifact check stops before GHCR login or publication. The verifier
must not contact production data or credentials. Capacity must be based on
actual run evidence, not inferred from runner specifications.

Candidate data at `/app/data` is disposable and container-scoped. Mount it as
tmpfs with mode `1777` so the image's default user can write there without
binding host temporary data into the container. Keep the image's default
`USER`; do not change the Dockerfile or run smoke checks as root. Removing the
candidate removes its tmpfs without asking the host runner to unlink files
owned by the container user.

Verifier cleanup must not replace a primary verification error. Collect the
primary error and cleanup errors independently, including errors from
`smokeCandidate`, UI extraction, and image comparison cleanup. After all
cleanup actions run, return success only if artifact verification passed and
cleanup produced no errors. If verification failed, surface that error first
and include every cleanup error. If verification passed but cleanup failed,
fail the verifier and block publication; never ignore cleanup failure.

## Main build failures and selected correction

PR #11 merged at `3a484460`. First main workflow run `37124029642` failed
after 4 minutes 17 seconds in `npm run build:backend`. Its V8 GC output showed
repeated ineffective mark-compacts and allocation failure at an effective
old-space limit of approximately 1043 MiB. No image was published. At the
time, the Dockerfile had no `NODE_OPTIONS`; the build helper sets 8192 only
when no option is inherited, so the official base's existing setting took
precedence.

Set `ENV NODE_OPTIONS=--max-old-space-size=12288` in the Docker builder stage
before the backend compiler. Keep this environment override out of the runtime
stage and do not change the shared build helper. The chosen 12288-MiB heap is
grounded in a prior successful remote compile of the same backend using a
12-GiB heap with approximately 15.72 GB measured peak, and the public
`ubuntu-24.04-arm` runner's stated 16 GB. The failed run did not measure process
RSS, cgroup peak, or Node version; do not claim those values. PR #12 merged
this heap correction. Run `37125217705` did not repeat the heap failure, but
did not complete the build.

The second main run failed after 6m18 during prerendering `/_global-error`:
`TypeError: Cannot read properties of null (reading 'use')`, followed by
`Export encountered an error on /_global-error/page`; the Next worker exited 1
at about 214.4 seconds. The workflow did not log in to GHCR or publish an
image. Read-only diagnosis found the Dockerfile sets `NODE_ENV=development`
for `npm ci` and leaves it set for compilation; the installed Next CLI
preserved it, and the logs showed React development warnings. The exact
minified callsite was not isolated. After `npm ci`, set builder-only
`NODE_ENV=production` before `npm run build:backend`; keep the final runtime
stage on its fresh base environment.

This environment correction responds to observed build state; it does not
prove the exact minified null-`use` callsite is identified. The next main image
build and container artifact checks remain open acceptance gates. Retain its
exact logs and measured evidence if it fails; do not add speculative resource
limits.

## Candidate verifier permission failure and correction

Third main run `37126849223` completed native ARM64 image build and backend
compilation in about 9 minutes, then failed in verification cleanup with
`EACCES: permission denied` unlinking
`/tmp/omni-overlay-data-uR7ulC/cache/openrouter-provider-stats.json`. Diagnosis
found that the verifier bind-mounted host temporary data at `/app/data`; the
candidate kept the image's default `node` user (UID 1000), which created the
file, while GitHub runner UID 1001 could not unlink it. The cleanup `finally`
path may have hidden a primary verification error, so this output does not
prove the preceding candidate checks passed. BuildKit GHA cache export
succeeded in 25.3 seconds; GHCR login and publication were skipped.

Mount candidate `/app/data` as container-scoped tmpfs with mode `1777`; retain
the image's default `USER` and remove the host data bind. Run cleanup actions
without allowing a cleanup throw to replace the primary verifier error. Report
the primary error and all cleanup errors together. A cleanup failure after
otherwise successful artifact checks still fails verification and blocks
publication. The next main run must pass all artifact checks before GHCR
authentication. Do not infer a verifier pass from this failed run.

## Catalog-auth assertion diagnosis

Fourth main run `37129219486` built the candidate in 8m28, then failed the
unauthenticated direct UI `/api/v1/models` assertion. The run did not record
the observed status or response fields, so actual runtime behavior remains
unknown. Read-only source/configuration inspection predicts HTTP 401 with
`error.code: "invalid_api_key"` for the disposable fixture: `INITIAL_PASSWORD`
is set, `requireLogin` is true, `requireAuthForModels` opt-out is absent, and
the bridge peer is guarded. This establishes expected source behavior only;
it does not establish the candidate's actual response.

Keep the auth fixture and HTTP 401 / `invalid_api_key` gate unchanged. Change
only assertion-failure diagnostics: include expected status/code, observed
HTTP status, and `error.type` / `error.code` when those are string values.
Sanitize control characters and cap each field at 64 characters before
including it in the failure message. Read only these allowlisted fields;
never include response body, headers, credentials, model data, or serialized
error objects. If JSON parsing or a field lookup fails, report `<unavailable>`
for that field. This diagnostic explains a mismatch without weakening auth or
claiming a response before the next native main run.

## Review and server acceptance

Review and merge the feature branch manually. The PR includes the already
reviewed runtime changes and eligible completed OpenSpec archives, not a
CI-only change. Do not depend on automatic unit, static, or workflow checks;
run tests manually when the task requires them. Native ARM64 image
compilation now passes on run `37126849223`; the candidate verifier correction
must reach main and pass before image publication.

GHCR creates a package as private. After the first successful main
publication, the owner changes it to public in GitHub Packages. Workflow code
leaves package settings unchanged. Verify an anonymous pull before using the
image on the server.

Before the operator-run pull, record current digest, Compose configuration,
Docker health status, direct UI root (`127.0.0.1:20128/` returns HTTP 200),
and database-migration state. API behavior is checked separately with its
specific routes, including unauthenticated `GET /api/v1/models` on the direct
UI listener returning HTTP 401 with `error.code: "invalid_api_key"`. Do not
probe UI health paths through the API listener proxy on `20129`. Pull
`ghcr.io/etcetera-agency/omniroute:main`, compare its resolved digest and OCI
labels with the main Actions summary, verify ARM64, then start it using
`docker compose up -d --no-build`. Check server health, native SQLite,
dashboard and API behavior. On failure, restore the prior digest-pinned image,
run `docker compose up -d --no-build`, and verify prior health. The workflow
does not deploy to production or run database migrations. Do not call the
image transition accepted until the main workflow, public anonymous pull, and
server acceptance pass.

## External references

- [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub Container Registry access and visibility](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
