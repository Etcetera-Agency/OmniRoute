## ADDED Requirements

### Requirement: Selective Release Workflow Hardening

The release automation SHALL run the upstream hardening checks that are independent of fork
image ownership: reject self-targeting pull requests, verify generated agent skills, use pinned
action/CodeQL/zizmor/scanner versions, compare quality ratchets against the pull-request base,
verify Electron release assets, guard npm artifact reuse and clean/upgrade installs, and resolve
Docker release versions through validated environment inputs. Workflow checks SHALL be executable
with `actionlint`, `zizmor`, and repository workflow tests.

#### Scenario: Self-target pull request is rejected early

- **GIVEN** a pull request's head branch/ref is the same as its base branch/ref
- **WHEN** the CI change-classification job starts
- **THEN** the self-target guard fails before expensive build/test jobs run
- **AND** a normal pull request with distinct head and base continues to classification

#### Scenario: Generated agent skills are checked in CI

- **GIVEN** a change modifies a route or skill source that affects generated agent skills
- **WHEN** the CI static checks run
- **THEN** the agent-skill synchronization check runs
- **AND** CI fails when generated skill files differ from the repository source

#### Scenario: Workflow tools are reproducible

- **GIVEN** CI installs actionlint, zizmor, CodeQL, or another workflow/security scanner
- **WHEN** the workflow lint/security jobs run
- **THEN** each tool and action reference resolves to the pinned version configured by the repo
- **AND** the effective versions are visible in job output or ratchet evidence

#### Scenario: Quality ratchet is base-relative for pull requests

- **GIVEN** a quality workflow is triggered by a pull request with a base commit
- **WHEN** file-size or related ratchet checks run
- **THEN** the check compares against the frozen baseline and the base commit's measured value
- **AND** an inherited base violation does not fail an otherwise non-regressing pull request
- **AND** manual dispatch without a base commit uses the absolute baseline mode

#### Scenario: Electron release publishes only verified platform assets

- **GIVEN** multiple Electron platform jobs upload installers and per-architecture updater
  manifests
- **WHEN** the release job assembles assets
- **THEN** manifests are merged deterministically without same-name arrival-order overwrites
- **AND** a separate verification job asserts required Windows, macOS, Linux, updater, and
  source archive assets are attached
- **AND** npm publication remains independently gated from a desktop-only verification failure

#### Scenario: npm publication cannot consume fork-built artifacts

- **GIVEN** npm publication searches for a reusable CI build artifact
- **WHEN** candidate workflow runs are selected
- **THEN** only runs originating from the repository being published are eligible
- **AND** artifact presence is tried across retained candidates before rebuilding
- **AND** clean-install and upgrade-over-previous boot checks pass before staged or direct publish

#### Scenario: Docker release version is validated and fork images remain

- **GIVEN** Docker publication runs from a tag, release event, default branch, or manual input
- **WHEN** the version/channel is resolved
- **THEN** the env-safe resolver validates the value before it reaches image tags
- **AND** existing GHCR, DockerHub, fork image names, mutable channels, and publication triggers
  remain unchanged

### Requirement: Intentional Workflow Trigger Preservation

The release hardening SHALL preserve the fork's intentional trigger topology. It SHALL NOT
reintroduce a scheduled trigger to a workflow whose schedule was deliberately removed, and it
SHALL NOT delete, retarget, or rename the fork-owned GHCR, DockerHub, or image-build workflows.

#### Scenario: Manual Node compatibility remains unscheduled

- **GIVEN** the `Nightly Node Compat` workflow is present
- **WHEN** workflow validation runs
- **THEN** the workflow retains `workflow_dispatch`
- **AND** it has no `schedule` trigger

#### Scenario: Continuous release-green remains unscheduled

- **GIVEN** the fork's `Release-Green (continuous)` workflow is present
- **WHEN** workflow validation runs
- **THEN** its push and manual-dispatch triggers remain intact
- **AND** no upstream nightly schedule is added to that workflow

#### Scenario: Fork image workflows remain callable

- **GIVEN** the fork GHCR, DockerHub, and supplemental image workflows are present
- **WHEN** workflow validation runs
- **THEN** their existing names, image destinations, and supported triggers remain present
- **AND** upstream workflow cleanup does not remove or replace them
