# GitHub ARM64 Overlay Image Build

## Purpose

Build, verify, publish, and consume the fork's official-UI/backend-overlay
container from a reviewed main commit without compiling source on the server.

## ADDED Requirements

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
NOT use QEMU, a paid larger runner, or a self-hosted runner.

#### Scenario: Main candidate build

- **GIVEN** a checked-out canonical main commit and the pinned official base
- **WHEN** the image builder creates its candidate
- **THEN** it performs one backend-only compilation without invoking unit-test
  commands
- **AND** the candidate retains the official dashboard, static files, and
  runtime configuration
- **AND** one local candidate is loaded for artifact verification

#### Scenario: Cache unavailable

- **GIVEN** no reusable ref-scoped BuildKit cache exists
- **WHEN** the main image workflow builds
- **THEN** it performs a clean build
- **AND** cache absence does not change build correctness

### Requirement: Verify the actual container artifact before publication

The main image workflow SHALL start and inspect its local candidate before
GHCR authentication or publication. It SHALL check ARM64 architecture and
source/revision/base metadata, native SQLite operation, health, dashboard
response, direct API behavior, and official UI preservation by comparing
`BUILD_ID`, the full static tree, page manifest, and every non-API app-path
entry with the pinned official image. The direct Next UI listener SHALL return
HTTP 401 with `error.code: "invalid_api_key"` for unauthenticated
`GET /api/v1/models`. Smoke checks SHALL use disposable runner-local data and
SHALL NOT access production credentials or data. A failed artifact check SHALL
stop the workflow before registry authentication and SHALL publish no image.

#### Scenario: Candidate passes artifact verification

- **GIVEN** the candidate has matching architecture, source, revision, and
  official-base identity
- **AND** disposable native SQLite and health checks pass
- **AND** dashboard and direct API behavior pass
- **AND** unauthenticated `GET /api/v1/models` on the direct UI listener
  returns HTTP 401 with `error.code: "invalid_api_key"`
- **AND** all checked UI build assets and non-API paths match the pinned
  official image
- **WHEN** artifact verification completes
- **THEN** the publisher may authenticate and publish that candidate

#### Scenario: Candidate artifact check fails

- **GIVEN** any identity, native SQLite, health, route, or UI comparison fails
- **WHEN** the main image workflow evaluates the candidate
- **THEN** the workflow fails before GHCR login
- **AND** no tag is published or updated

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
change package visibility or add signed-attestation infrastructure.

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

### Requirement: Pull the main image on the server without building source

The production Compose configuration SHALL consume
`ghcr.io/etcetera-agency/omniroute:main` and SHALL NOT build source on the
server. An operator SHALL resolve and compare the image digest with the
successful main workflow summary, verify ARM64 architecture and OCI labels,
and run `docker compose up -d --no-build`. Deployment SHALL remain
operator-run; the workflow SHALL NOT deploy to production or run database
migrations.

#### Scenario: Operator accepts the main image

- **GIVEN** the main workflow published and recorded the candidate digest
- **AND** the GHCR package is public and an anonymous pull succeeds
- **WHEN** the operator pulls `:main`
- **THEN** the resolved digest, architecture, and OCI labels match the main
  workflow summary
- **AND** the operator starts the image with `docker compose up -d --no-build`
- **AND** server health, native SQLite, dashboard, and API checks pass

#### Scenario: Server acceptance fails

- **GIVEN** the pulled main image fails server acceptance
- **WHEN** the operator rolls back
- **THEN** the prior recorded digest is restored in Compose
- **AND** the operator runs `docker compose up -d --no-build`
- **AND** the previous container health is verified
