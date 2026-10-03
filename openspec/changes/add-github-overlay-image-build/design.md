# Design: Main-only GitHub overlay image

## Decision

Build and publish the fork's ARM64 overlay image only from `main`. A push to
`main` and a manual dispatch whose selected ref is exactly `refs/heads/main`
run one native build, the acceptance checks, and then publication. Pull
requests and feature branches may run ordinary unit, OpenSpec, workflow
syntax, and static checks, but they do not build Docker images, run the
backend-only compiler, or receive package-write permission. The first real
image build therefore occurs after the reviewed runtime/spec PR is merged.

The image reuses `docker/official-backend-overlay.Dockerfile` and its pinned
official UI/backend base:

```text
ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96
```

Build on `ubuntu-24.04-arm` for `linux/arm64`; do not use QEMU or paid/self-
hosted runners. The backend builder runs the focused manifest-merger test,
then compiles backend routes exactly once. Retain the official dashboard,
static assets, and runtime configuration. Load one candidate image locally;
run all checks against that exact image before logging in to GHCR or pushing.

## Workflow

```text
on push where ref == refs/heads/main, or workflow_dispatch where ref == refs/heads/main:
    grant build job contents:read
    checkout the triggering main commit
    run ordinary unit/spec/workflow/static checks required by repository policy
    run merger unit test before backend compilation
    build one linux/arm64 candidate with the pinned official base
    run native ARM64, metadata, disposable SQLite, health, API, and UI-parity checks
    if any check fails: fail without registry login or publication
    grant publisher only contents:read and packages:write
    login to ghcr.io with GITHUB_TOKEN
    publish the tested candidate as ghcr.io/etcetera-agency/omniroute:<full-commit-sha>
    publish the same manifest as ghcr.io/etcetera-agency/omniroute:main
    record registry digest, source URL/SHA, base digest, and Actions run URL

on pull_request targeting main:
    run ordinary unit/spec/workflow-syntax/static checks
    do not build a Docker image or run the backend-only compiler
    do not login to a registry or publish

on feature branch:
    run ordinary unit/spec/workflow-syntax/static checks
    do not build a Docker image or run the backend-only compiler
    do not publish
```

The publisher guard must verify both the canonical repository and exact main
ref. The manual event must not make a feature ref eligible. The mutable `main`
tag is written only by a successful main run. A full-SHA tag is a locator, not
an immutability guarantee; the published OCI manifest digest is the artifact
identity. Apply OCI source, revision, and official-base-digest labels and
include those values and the digest in the run summary. Do not add a separate
signed-attestation service.

The main image job has only `contents: read` and `packages: write` where
publication is required. Pull-request and check jobs have `contents: read`
only. Disable checkout credential persistence. Use no Docker Hub secrets,
upstream namespace write access, server pull credentials, or production deploy
secrets. Keep BuildKit GHA cache best-effort, scoped by ref, and `mode=min`;
cache misses must result in an ordinary clean build. Do not export a large
compiler cache artifact.

## Candidate acceptance

The main candidate passes all checks before registry authentication:

1. The existing manifest-merger unit test passes before backend compilation.
2. Image architecture is `linux/arm64`; OCI source, full revision, and base
   digest match the triggering commit and pinned base.
3. The application starts with isolated, disposable runner-local data; the
   health endpoint succeeds and a native SQLite query succeeds.
4. Dashboard response and direct Next UI API route dispatch pass. On the
   candidate's UI listener (`20128`), unauthenticated `GET /api/v1/models`
   returns HTTP 401 with `error.code: "invalid_api_key"`, as implemented by
   the route handler. `AUTH_002` is produced by the separate API listener
   proxy and is not the expected direct-handler response.
5. Against the pinned official image, `BUILD_ID`, full static tree, page
   manifest, and every non-API app-path entry are identical.

Any failure stops the job before GHCR login or publication. The verifier must
not contact production data or credentials. Do not infer successful build
capacity from public runner specifications; record actual logs and evidence.

## Pull request and server acceptance

The feature PR to `main` includes the reviewed runtime branch work and its
eligible completed OpenSpec archives, not only the image workflow. Before
merge, strict OpenSpec validation, unit tests, static checks, and workflow
syntax/actionlint pass. The PR does not perform the full Docker/backend build.
After merge, the first actual ARM64 build runs on `main`; if it fails, retain
the failure evidence and correct it through a follow-up PR.

GHCR creates a new package as private. After the first successful main
publication, the owner changes that package's visibility to public in GitHub
Packages. Workflow code leaves package settings unchanged. Verify an
unauthenticated pull succeeds before using it on the server.

The operator records the currently deployed digest, Compose configuration,
health, and database-migration state. Then the operator pulls
`ghcr.io/etcetera-agency/omniroute:main`, checks that its resolved digest and
OCI labels match the successful Actions summary, and starts it using
`docker compose up -d --no-build`. Check ARM64 architecture, health, SQLite,
dashboard, and API dispatch. If acceptance fails, restore the previous
digest-pinned image and run `docker compose up -d --no-build`; verify the
previous container is healthy. The workflow does not deploy to production or
run database migrations. Do not call the image transition accepted until the
main workflow, public anonymous pull, and server checks all pass.

## External references

- [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub Container Registry access and visibility](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
