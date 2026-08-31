# ci-workflow-scheduling Specification

## Purpose

TBD - created by archiving change disable-nightly-node-compat-schedule. Update Purpose after archive.

## Requirements

### Requirement: Manual Node compatibility validation

The `Nightly Node Compat` workflow SHALL be manually dispatchable with its optional
release-branch input and SHALL NOT use a GitHub Actions scheduled trigger.

#### Scenario: Operator starts compatibility validation

- **WHEN** an operator dispatches `Nightly Node Compat`, with or without a branch input
- **THEN** the workflow accepts the request and runs its existing compatibility jobs
- **AND** no daily scheduled run is created by this workflow.
