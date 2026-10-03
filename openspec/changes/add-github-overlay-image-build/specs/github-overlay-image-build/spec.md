# GitHub ARM64 Overlay Image Build

## Purpose

Build, verify, publish, and consume the fork's official-UI/backend-overlay
container from a reviewed main commit without compiling source on the server.

## ADDED Requirements

### Requirement: Build images only from the canonical main branch

The repository SHALL run Docker image construction and the backend-only
compiler only for a push to `refs/heads/main` or a manual dispatch whose
selected ref is exactly `refs/heads/main` in `Etcetera-Agency/OmniRoute`.
Pull requests and feature branches MAY run ordinary unit, OpenSpec, workflow
syntax, and static checks, but SHALL NOT build Docker images, invoke the
backend-only compiler, authenticate for publication, or receive registry
write permission. A PR to main SHALL pass review and its required checks
before merge.

#### Scenario: Main push

- **GIVEN** a commit reaches `refs/heads/main` in the canonical repository
- **WHEN** the image workflow runs
- **THEN** it builds and verifies one native ARM64 candidate from that commit
- **AND** it publishes only after every candidate gate passes

#### Scenario: Manual main dispatch

- **GIVEN** a user manually dispatches the workflow with selected ref exactly
  `refs/heads/main`
- **WHEN** the workflow runs
- **THEN** it builds and verifies the selected main commit
- **AND** it may publish only after every candidate gate passes

#### Scenario: Pull request to main

- **GIVEN** a pull request targets main
- **WHEN** its required checks run
- **THEN** they perform ordinary unit, OpenSpec, workflow syntax, and static
  validation only
- **AND** they do not invoke Docker or the backend-only compiler
- **AND** they have no registry write permission and publish no image

#### Scenario: Feature branch or manual non-main ref

- **GIVEN** a feature branch is pushed or a manual dispatch selects a ref
  other than exact main
- **WHEN** the repository checks run
- **THEN** no Docker image or backend compilation runs
- **AND** no image is published

### Requirement: Build from the pinned official UI image

The main workflow SHALL use native `ubuntu-24.04-arm` and
`docker/official-backend-overlay.Dockerfile` with official base
`ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`.
It SHALL run the focused manifest-merger test before compilation, compile
backend routes once, preserve the official dashboard and runtime, and load
one `linux/arm64` candidate for verification and publication. It SHALL NOT
use QEMU, a paid larger runner, or a self-hosted runner.

#### Scenario: Main candidate build

- **GIVEN** a checked-out canonical main commit and the pinned official base
- **WHEN** the Docker builder creates its candidate
- **THEN** the merger test passes before one backend-only compiler invocation
- **AND** the candidate retains the official dashboard, static files, and
  runtime configuration
- **AND** the same locally verified candidate is the one published

#### Scenario: Cache unavailable

- **GIVEN** no reusable ref-scoped BuildKit cache exists
- **WHEN** the main image job builds
- **THEN** it performs a clean build
- **AND** cache absence does not change build correctness

### Requirement: Verify the main candidate before registry authentication

The main workflow SHALL verify the local ARM64 candidate before GHCR login or
publication. It SHALL check architecture and source/revision/base metadata,
native SQLite operation, health, dashboard response, API dispatch, and exact
official UI preservation by comparing `BUILD_ID`, the full static tree, page
manifest, and every non-API app-path entry with the pinned official image.
The direct Next UI listener SHALL return HTTP 401 with
`error.code: "invalid_api_key"` for unauthenticated `GET /api/v1/models`.
Smoke checks SHALL use disposable runner-local data and SHALL NOT access
production credentials or data. A failed gate SHALL fail the workflow before
registry authentication and SHALL publish no image.

#### Scenario: Candidate passes all gates

- **GIVEN** the merger test passes and the local candidate has matching
  `linux/arm64`, source, revision, and official base identity
- **AND** disposable native SQLite, health, dashboard, and API dispatch
  checks pass
- **AND** unauthenticated `GET /api/v1/models` on the direct UI listener
  returns HTTP 401 with `error.code: "invalid_api_key"`
- **AND** the full UI comparison matches the pinned official image
- **WHEN** candidate verification completes
- **THEN** the publisher may authenticate and publish that candidate

#### Scenario: Candidate gate fails

- **GIVEN** any identity, merger, native SQLite, health, route, or UI check
  fails
- **WHEN** the main workflow evaluates the candidate
- **THEN** the workflow fails before GHCR login
- **AND** no tag is published or updated

### Requirement: Publish a traceable main image

After all candidate checks pass, the canonical main publisher SHALL publish
`ghcr.io/etcetera-agency/omniroute` under the full source commit SHA and
`main` tags. Only a verified `refs/heads/main` run SHALL update `:main`; both
tags SHALL refer to the tested candidate. The publisher SHALL use only
`GITHUB_TOKEN`, scoped to `contents: read` and `packages: write`, and SHALL
record the actual registry manifest digest, canonical source URL, source SHA,
pinned base digest, and Actions run URL. OCI source, revision, and base-digest
labels SHALL match those values. A tag SHALL NOT be treated as immutable; the
manifest digest is the image identity. The workflow SHALL NOT change package
visibility or add a signed-attestation service.

#### Scenario: Main publication succeeds

- **GIVEN** all main candidate gates pass
- **WHEN** the publisher completes
- **THEN** the full-SHA and `:main` tags resolve to the same manifest digest
- **AND** the workflow summary records digest, source, revision, base digest,
  and run URL
- **AND** the OCI labels match the summary

#### Scenario: New package visibility

- **GIVEN** GHCR creates the package during its first publish
- **WHEN** the image is published
- **THEN** the workflow leaves the package's default private visibility
  unchanged
- **AND** the owner changes package visibility to public in GitHub Packages
  after a successful first main publication
- **AND** an anonymous pull is verified before the server consumes the image

### Requirement: Pull the main image on the server without building source

The production Compose configuration SHALL consume
`ghcr.io/etcetera-agency/omniroute:main` and SHALL NOT build source on the
server. An operator SHALL resolve and compare the image digest with the
successful main workflow summary, verify ARM64 architecture and OCI labels,
and run `docker compose up -d --no-build`. Deployment SHALL remain
operator-run; the workflow SHALL NOT deploy to production or run database
migrations.

#### Scenario: Operator accepts the main image

- **GIVEN** the main workflow published and recorded a candidate digest
- **AND** the GHCR package is public and an anonymous pull succeeds
- **WHEN** the operator pulls `:main`
- **THEN** the resolved digest, architecture, and OCI labels match the main
  workflow summary
- **AND** the operator starts the image with `docker compose up -d --no-build`
- **AND** server health, native SQLite, dashboard, and API dispatch checks
  pass

#### Scenario: Server acceptance fails

- **GIVEN** the pulled main image fails server acceptance
- **WHEN** the operator rolls back
- **THEN** the prior recorded digest is restored in Compose
- **AND** the operator runs `docker compose up -d --no-build`
- **AND** the previous container health is verified
