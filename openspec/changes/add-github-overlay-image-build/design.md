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

## Workflow pseudocode

```text
on push where ref == refs/heads/main,
or workflow_dispatch where ref == refs/heads/main:
    grant the image job contents:read
    checkout the triggering main commit
    build one linux/arm64 candidate from the pinned official base
    in the backend builder stage, set NODE_OPTIONS=--max-old-space-size=12288
    before npm run build:backend; do not export this to the runtime stage
    compile backend routes exactly once; do not run unit-test commands
    load the candidate locally
    inspect candidate architecture and OCI source/revision/base labels
    start candidate with isolated disposable runner-local data
    verify process health and a native SQLite operation
    verify dashboard response and direct UI API response:
        GET http://127.0.0.1:20128/api/v1/models without credentials
        expect HTTP 401 and error.code == "invalid_api_key"
    compare BUILD_ID, complete static tree, page manifest, and every
        non-API app-path entry with the pinned official image
    if any artifact check fails: stop; do not authenticate or publish
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
2. The application starts with isolated disposable runner-local data; its
   health endpoint and a native SQLite operation succeed.
3. The dashboard returns successfully. Direct Next UI listener `20128` returns
   HTTP 401 with `error.code: "invalid_api_key"` for unauthenticated
   `GET /api/v1/models`. `AUTH_002` belongs to the separate API listener proxy
   and is not this direct route-handler response.
4. Against the pinned official image, `BUILD_ID`, full static tree, page
   manifest, and every non-API app-path entry match exactly.

Any failed artifact check stops before GHCR login or publication. The verifier
must not contact production data or credentials. Capacity must be based on
actual run evidence, not inferred from runner specifications.

## First main build failure and correction

PR #11 merged at `3a484460`. First main workflow run `37124029642` failed
after 4 minutes 17 seconds in `npm run build:backend`. Its V8 GC output showed
repeated ineffective mark-compacts and allocation failure at an effective
old-space limit of approximately 1043 MiB. No image was published. The
Dockerfile had no `NODE_OPTIONS`; the build helper sets 8192 only when no
option is inherited, so the official base's existing setting took precedence.

Set `ENV NODE_OPTIONS=--max-old-space-size=12288` in the Docker builder stage
before the backend compiler. Keep this environment override out of the runtime
stage and do not change the shared build helper. The chosen 12288-MiB heap is
grounded in a prior successful remote compile of the same backend using a
12-GiB heap with approximately 15.72 GB measured peak, and the public
`ubuntu-24.04-arm` runner's stated 16 GB. The failed run did not measure process
RSS, cgroup peak, or Node version; do not claim those values. Treat the next
main workflow run as the acceptance test of this correction. If it fails,
retain its evidence and make a further narrowly scoped, manually reviewed PR;
do not claim the heap setting guarantees a fit.

## Review and server acceptance

Review and merge the feature branch manually. The PR includes the already
reviewed runtime changes and eligible completed OpenSpec archives, not a
CI-only change. Do not depend on automatic unit, static, or workflow checks;
run tests manually when the task requires them. After the reviewed change
reaches main, the image workflow performs the first actual ARM64 image build.
If it fails, retain logs and measured evidence and correct it through a
follow-up PR.

GHCR creates a package as private. After the first successful main
publication, the owner changes it to public in GitHub Packages. Workflow code
leaves package settings unchanged. Verify an anonymous pull before using the
image on the server.

Before the operator-run pull, record current digest, Compose configuration,
health, and database-migration state. Pull
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
