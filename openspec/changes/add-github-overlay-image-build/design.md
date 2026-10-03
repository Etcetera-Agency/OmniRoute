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
    create backend-dependencies stage from the pinned official image
    install lockfile-resolved backend/Playwright dependencies once
    create backend-builder FROM backend-dependencies
    in the backend builder stage:
        ENV NODE_ENV=production
        ENV NODE_OPTIONS=--max-old-space-size=12288
        RUN npm run build:backend
    select backend-builder for source builds, or prebuilt-backend when supplied
    keep backend-builder separate so prebuilt packaging does not compile it
    create runtime from the pinned official image plus merged backend overlay
    create runtime-web FROM runtime
    copy playwright and playwright-core from backend-dependencies
    set PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
    as root, install xvfb and xauth, then run
        node node_modules/playwright/cli.js install chromium --with-deps
    chown browser cache to node:node, then restore USER node
    wrap /app/check-permissions.sh in entrypoint:
        xvfb-run -a -s '-screen 0 1920x1080x24 -nolisten tcp'
        /app/check-permissions.sh
    declare CMD ["node", "dev/run-standalone.mjs"] in runtime-web
    preserve the pinned-base HEALTHCHECK unchanged
    build main candidate with --target runtime-web
    do not export either build environment setting to the runtime stage
    compile backend routes exactly once; do not run unit-test commands
    load the candidate locally
    inspect candidate architecture and OCI source/revision/base labels
    inspect candidate image config before starting it:
        require USER == "node"
        require ENTRYPOINT == ["xvfb-run", "-a", "-s",
            "-screen 0 1920x1080x24 -nolisten tcp",
            "/app/check-permissions.sh"]
        require CMD == ["node", "dev/run-standalone.mjs"]
        on mismatch, fail with bounded diagnostics for USER/ENTRYPOINT/CMD only
        do not log environment, credentials, or other config fields
    start candidate service container with Docker init enabled (--init /
        HostConfig.Init=true) and container-scoped tmpfs at /app/data, mode 1777
    preserve image's default USER; do not bind host temporary data
    verify configured Docker HEALTHCHECK reports healthy
    verify native SQLite operation
    verify direct Next UI listener behavior:
        GET http://127.0.0.1:20128/ expects HTTP 200
        GET http://127.0.0.1:20128/api/v1/models without credentials
        with REQUIRE_API_KEY=true, expect HTTP 401 and error.code == "AUTH_002"
        on mismatch, report expected status/code and observed HTTP status
        plus bounded sanitized error.type/error.code fields only
        never log response body, headers, credentials, or model data
    compare BUILD_ID, complete static tree, page manifest, and every
        non-API app-path entry with the pinned official image
    as default non-root user, launch Playwright Chromium with headless=false
    load about:blank only, close browser cleanly, send no external requests
    capture any verification error as the primary error
    run all cleanup actions, collecting every cleanup error
    if primary verification error or cleanup errors exist:
        report primary verification error first, plus every cleanup error
        fail verification; do not authenticate or publish
    login to ghcr.io using GITHUB_TOKEN
    publish tested image as ghcr.io/etcetera-agency/omniroute:<full-SHA>
    publish the same manifest as ghcr.io/etcetera-agency/omniroute:main
    record manifest digest, source URL/SHA, base digest, and Actions run URL
    render every dynamic summary line with a single-quoted printf format
    pass each public value as a separately quoted printf argument
    preserve Markdown backticks as literal summary characters
    append rendered evidence to GITHUB_STEP_SUMMARY

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

## Published-image summary quoting

Main run `37132155004` completed the native candidate image build, then failed
artifact verification with HTTP 401, `error.code: "AUTH_002"`, and no
`error.type`; GHCR login/publication did not run. Read-only diagnosis traces
the request through client-API auth middleware, which rejects before the
catalog handler. The earlier source-level `invalid_api_key` expectation missed
this path; the exact contract is described in the catalog-auth section below.
Preserve required-key behavior and assert the exact middleware response.

The original workflow summary placed Markdown backticks inside double-quoted
`echo` strings. Bash evaluated those backticks as command substitutions,
producing missing source, tag, digest, base, and run URL fields. A local shell
probe reproduced seven failed substitutions while `echo` still exited
successfully. The workflow now uses single-quoted `printf` formats and
separately quoted value arguments; a manual probe confirmed the values and
literal Markdown backticks are preserved. Summary correctness remains a
separate check from image publication.

Render each line using a single-quoted static `printf` format, with each
dynamic public value passed as its own quoted data argument. Keep Markdown
backticks in the literal format, append to `GITHUB_STEP_SUMMARY`, and never
place dynamic values in the format string. Manually run the summary block with
representative repository, SHA, image tag, digest, base, and run URL values;
compare exact output and confirm backticks remain literal and no shell
substitution executes.

## Browser-capable runtime

Current production uses `omniroute:55f40468-official-overlay-web-browser-20261003`
through the third browser Compose override. Its source copies the pinned
`playwright` and `playwright-core` packages, installs Chromium with Playwright
OS dependencies under `/home/node/.cache/ms-playwright`, and runs the existing
permission-check entrypoint under `xvfb-run`. The new public `:main` image
must retain that provider capability; the lean `runtime` target is not the
published candidate.

Split dependency installation into `backend-dependencies` and derive
`backend-builder` from it, so the backend compiler and web runtime share the
same lockfile-resolved packages. Keep `prebuilt-backend` packaging independent:
when selected, it must not pull `backend-builder` into the build graph merely
to obtain Playwright packages. Build the final candidate as `runtime-web FROM
runtime`; copy only `playwright` and `playwright-core` from
`backend-dependencies`, install Xvfb, Xauth, Chromium, and required OS
libraries, set `PLAYWRIGHT_BROWSERS_PATH`, and make the browser cache readable
by `node`. The final image keeps the pinned UI and merged manifests unchanged,
redeclares the original official default command as
`CMD ["node", "dev/run-standalone.mjs"]`, preserves the pinned-base
`HEALTHCHECK`, and wraps
`/app/check-permissions.sh` with `xvfb-run -a -s '-screen 0 1920x1080x24
-nolisten tcp'` as the selected entrypoint.

Docker resets a base-image `CMD` to empty when the current stage defines a new
`ENTRYPOINT`, so the browser stage must declare its own `CMD`. Before starting
the image, the verifier inspects the image config and requires `USER node`,
the exact Xvfb permission-check entrypoint, and the exact Node server command
above. It fails before container startup if any field is absent or different,
reporting only bounded, allowlisted user/entrypoint/command values.

The main workflow builds `--target runtime-web`. Before registry auth, run a
one-shot Playwright smoke inside the candidate as its default non-root user:
launch Chromium with `headless: false` under the image's Xvfb entrypoint, open
`about:blank`, and close the browser. Make no external requests. Also compare
UI assets/manifests with the pinned official image as already specified.
Server acceptance records the three active Compose files and last digest
override; rollback remains pinned to the current browser-capable image until
the new image passes browser and health checks.

## Container artifact acceptance

The main image workflow verifies the built candidate itself before registry
authentication:

1. Architecture is `linux/arm64`; OCI source, full revision, and base digest
   match the triggering commit and pinned base.
2. Before startup, image config has the exact default user, Xvfb entrypoint,
   and Node server `CMD`; mismatches fail with safe allowlisted diagnostics.
   The application starts with disposable container-scoped `/app/data` tmpfs;
   the configured Docker `HEALTHCHECK` reports healthy and a native SQLite
   operation succeeds.
3. Direct Next UI listener `20128` returns HTTP 200 for `/` and HTTP 401 with
   `error.code: "AUTH_002"` for unauthenticated `GET /api/v1/models` when
   `REQUIRE_API_KEY=true`.
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

Fourth run `37129219486` built the candidate in 8m28, then failed the
unauthenticated direct UI `/api/v1/models` assertion without logging the actual
response. An initial handler-level source reading predicted `401
invalid_api_key`; this prediction was incomplete and is superseded by the next
run and full call-path diagnosis below.

Fifth main run `37132155004` completed native candidate image build, then
observed HTTP 401, `error.code: "AUTH_002"`, and no `error.type`. GHCR login
and publication were skipped. Read-only diagnosis follows
`classify.ts:95` -> `proxy.ts:23` -> `runAuthzPipeline` -> `clientApi.ts:61`:
the request is classified as client API and rejected by auth middleware
before reaching the catalog handler. The response pipeline at `pipeline.ts:62`
emits the code without `error.type`. This matches `REQUIRE_API_KEY=true`; the
smoke contract had expected the unreached handler's `invalid_api_key` code.

Set `REQUIRE_API_KEY=true` in the disposable smoke fixture and expect exactly
HTTP 401 with `error.code: "AUTH_002"`. Do not accept any arbitrary 401 or
the handler's `invalid_api_key` code. Keep assertion-failure diagnostics:
include expected status/code, observed HTTP status, and `error.type` /
`error.code` when those are string values.
Sanitize control characters and cap each field at 64 characters before
including it in the failure message. Read only these allowlisted fields;
never include response body, headers, credentials, model data, or serialized
error objects. If JSON parsing or a field lookup fails, report `<unavailable>`
for that field. This reports mismatches without weakening auth or treating the
earlier runtime result as proof of full artifact acceptance.

## Review and server acceptance

Review and merge the feature branch manually. The PR includes the already
reviewed runtime changes and eligible completed OpenSpec archives, not a
CI-only change. Do not depend on automatic unit, static, or workflow checks;
run tests manually when the task requires them. Native backend and browser
packages built on main run `37138784470`, but the candidate healthcheck became
unhealthy (`172.17.0.3: fetch failed`), publication was skipped, and API,
browser, and UI checks were not proven. Its logs do not show the image command
configuration. Static inspection identified that `runtime-web` replaced
`ENTRYPOINT` without redeclaring `CMD`; Docker clears the base-image `CMD` in
that case. The selected fix explicitly declares the official
`CMD ["node", "dev/run-standalone.mjs"]` and preflights `USER`, `ENTRYPOINT`,
and `CMD` before candidate startup. This known configuration defect is not
proof of the observed healthcheck's runtime cause. Focused local verifier
tests pass 9/9; scoped lint/format/diff checks, Code Simplifier, and independent
review pass. The exact CI fixture without Docker init stayed running but
unhealthy; auth/browser checks did not run. Read-only production configuration
confirms `HostConfig.Init=true`, with `docker-init` as PID 1. In the same
old-backend disposable verifier fixture, only Docker init changed: without it,
Xvfb stalled before Node; with it, the default `node` user process ran healthy.
Direct UI root returned HTTP 200 after redirect, `GET /api/v1/models` returned
exactly HTTP 401 `AUTH_002`, and headed Chromium opened/closed `about:blank`
under Xvfb as UID 1000. This validates init parity for that fixture only; it
is not proof for the corrected `runtime-web` image. The verifier SHALL start
only the candidate service container with Docker init enabled (`docker run
--init`, equivalent to `HostConfig.Init=true`); browser smoke uses
`docker exec` inside that started container. The next main run must prove
command config, healthy startup, browser smoke, and full artifact acceptance
before publication.

GHCR creates a package as private. After the first successful main
publication, the owner changes it to public in GitHub Packages. Workflow code
leaves package settings unchanged. Verify an anonymous pull before using the
image on the server.

Before the operator-run pull, record current digest, Compose configuration,
Docker health status, direct UI root (`127.0.0.1:20128/` returns HTTP 200),
and database-migration state. API behavior is checked separately with its
specific routes, including unauthenticated `GET /api/v1/models` on the direct
UI listener returning HTTP 401 with `error.code: "AUTH_002"` when
`REQUIRE_API_KEY=true`. Do not
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
- [Dockerfile CMD and ENTRYPOINT interaction](https://docs.docker.com/reference/dockerfile/#understand-how-cmd-and-entrypoint-interact)
