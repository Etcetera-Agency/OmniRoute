# Change: Build and Pull OmniRoute Overlay Image from GitHub

**Status:** Approved for implementation after the user's request to build the
image from GitHub and have the server pull the main-built image.

## Why

The full dashboard build repeatedly exhausted memory on the deployment server.
The accepted delivery already uses the upstream official ARM64 image for its
dashboard and adds only the fork's compiled API server. The deployment server
must stop compiling OmniRoute source and consume the reviewed image published
from the fork's `main` branch.

## What Changes

- Add a publisher workflow that runs Docker/backend compilation only for
  `push` to `main` and manual dispatch with the selected ref exactly
  `refs/heads/main`. Feature branches and pull requests do not build Docker
  images or run the backend-only compiler.
- Keep pull-request validation to ordinary unit tests, strict OpenSpec checks,
  workflow syntax checks, and static checks. Pull-request jobs receive no
  registry write permission. Review and merge the runtime work and eligible
  completed OpenSpec archives already on the feature branch through one PR;
  do not submit a CI-only PR that omits this runtime work.
- On the native `ubuntu-24.04-arm` runner, build the existing
  `docker/official-backend-overlay.Dockerfile` against the pinned official
  digest
  `ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`.
  Compile backend routes once and preserve the official UI.
- Before GHCR publication, run focused merger tests, ARM64/runtime/native
  SQLite checks, container health and route smoke, and byte-level official UI
  parity checks. Publish that same tested image under its full-SHA tag and
  `:main`; record the manifest digest and source/base/run metadata. Only
  `refs/heads/main` updates `:main`.
- Configure the server to pull `ghcr.io/etcetera-agency/omniroute:main`, verify
  its resolved digest against the main workflow, and start with
  `docker compose up -d --no-build`. Keep deployment operator-run, with a
  recorded prior digest and rollback procedure. Do not build source on the
  VPS.
- Use only `GITHUB_TOKEN` for main image publication. Do not add Docker Hub
  credentials, upstream write permission, or production deployment secrets.
  The workflow does not change package visibility. After the first successful
  main publication, the owner switches the new GHCR package from its default
  private state to public and verifies anonymous pull access.

## Impact

### Affected Specifications

- New capability: `github-overlay-image-build`.

### Affected Code

- `.github/workflows/omni-overlay-image.yml`: main-only native ARM64 build,
  verification, and GHCR publication.
- `scripts/ci/verify-official-overlay-image.mjs` and
  `tests/unit/build/verify-official-overlay-image.test.mjs`: local candidate
  identity, UI-parity, native SQLite, health, and route checks.
- `docker/official-backend-overlay.Dockerfile` and `.dockerignore`: run the
  focused merger test after dependencies are installed and before the one
  backend compile.
- `docker-compose.yml` and `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md`: pull the
  fork `:main` image and document digest verification, no-build start, health
  checks, and rollback.

### User Impact

The PR is validated without the expensive Docker/backend compile. After the PR
merges, the first real image build happens on `main`; the image cannot be
considered ready until that Actions run passes. The server then pulls the
main-built GHCR image instead of building on the VPS. If the first main build
fails for a real capacity or runtime reason, the correction goes through a
follow-up PR.

GitHub documents the standard public ARM64 runner as 4 CPU, 16 GB RAM, and
14 GB SSD. Those figures do not guarantee this compiler fits. Preserve actual
run evidence; do not introduce speculative capacity caps.

### API Changes

None. This packages the existing backend overlay.

### Migration Required

- [ ] Database migration
- [ ] API version bump
- [ ] Production deployment
- [x] GitHub image build and container smoke required before publication

## Security and Registry Access

The main publisher job has `contents: read` and `packages: write`; its
`GITHUB_TOKEN` is used only after candidate checks. PR validation has
`contents: read` only. Checkout credentials are not persisted. OCI source,
revision, and base-digest labels plus the registry digest and Actions run URL
provide traceability; the package does not add a signed-attestation service.
Package visibility is an external GitHub setting. The user must choose it
after the first successful main publication by changing the package to public.
The workflow leaves visibility unchanged, and no server registry credential
is required after anonymous pull access has been verified.

## Risks and Open Gates

- Merge only after strict OpenSpec, workflow syntax, unit, and static checks
  pass in the PR. No image build or backend full compile runs on feature/PR.
- Verify the first actual native ARM64 image build and publication on `main`.
  If it fails, retain logs and measured capacity evidence and prepare a
  follow-up PR; do not infer success from runner specifications.
- Verify package access, server pull digest, container health, native SQLite,
  dashboard/API behavior, and rollback to the prior digest before closing the
  production image transition.
- Verify upstream image provenance and rerun overlay compatibility whenever
  the official digest changes.
- Check whether the new Actions workflow is disabled. If activation is needed,
  activate only this fork workflow; leave unrelated upstream workflows
  disabled.
