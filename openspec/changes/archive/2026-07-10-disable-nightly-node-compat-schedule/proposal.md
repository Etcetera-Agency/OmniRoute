# Change: Disable scheduled Node compatibility runs

## Why

`Nightly Node Compat` runs daily by GitHub Actions schedule. Its release-branch resolver
currently has no matching branch and fails before compatibility validation, generating
unwanted Actions failure emails.

## What Changes

- Remove the `schedule` trigger from `nightly-compat.yml`.
- Keep `workflow_dispatch` and its optional `branch` input unchanged.
- Keep every job, permission, and manual compatibility validation path unchanged.

## Impact

- Affected specification: `ci-workflow-scheduling`.
- Affected file: `.github/workflows/nightly-compat.yml`.
- Automated daily Node 24/26 validation stops; operators can run the same workflow manually.
