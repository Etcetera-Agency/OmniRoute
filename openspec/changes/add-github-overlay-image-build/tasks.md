# Implementation Tasks

## 1. Manual task checks

- [x] 1.1 Update the manually invoked workflow-policy test to assert that the
      only active automatic image workflow is push to exact main plus manual
      exact-main dispatch, and no automatic test/check workflow triggers on
      feature push, PR, main push, or schedule.
- [x] 1.2 Add focused candidate-verifier tests for architecture, OCI source,
      revision/base labels, SQLite, health/API checks, and exact official-UI
      parity. The direct UI listener `20128` returns HTTP 401 with
      `error.code: "invalid_api_key"` for unauthenticated
      `GET /api/v1/models`.
- [x] 1.3 Add focused Compose/release-policy tests for the main GHCR image,
      digest verification, `up -d --no-build`, and rollback to the prior
      recorded digest.
- [x] 1.4 Manually run the focused task checks. Keep them detached from push,
      pull-request, main, and scheduled events.

## 2. Image implementation

- [x] 2.1 Implement the local candidate verifier and focused manual tests.
      Compare `BUILD_ID`, full static tree, page manifest, and every non-API
      app-path entry to the pinned official image; check disposable native
      SQLite, health, dashboard, and direct API behavior.
- [x] 2.2 Remove the manifest-merger unit-test invocation from
      `docker/official-backend-overlay.Dockerfile`; retain one backend-only
      compile and the approved pinned official base.
- [x] 2.3 Keep `.github/workflows/omni-overlay-image.yml` as the only active
      automatic project image/check workflow. It runs on canonical main push
      and manual dispatch selected on exact main; it performs no unit/static
      test job and verifies the actual built container before publication.
      Feature, PR, and schedule events run no automated checks.
- [x] 2.4 Give the image workflow only `contents: read` and `packages: write`.
      Use `GITHUB_TOKEN` after artifact checks, disable checkout credential
      persistence, and add no Docker Hub, upstream write, server, or production
      deployment secrets.
- [x] 2.5 Publish the verified candidate under the full source SHA and
      `:main` tags in `ghcr.io/etcetera-agency/omniroute`; only main can update
      `:main`. Record actual manifest digest, source URL/SHA, base digest, and
      Actions run URL without assuming SHA-tag immutability.
- [x] 2.6 Keep BuildKit GHA caching best-effort, ref-scoped, and `mode=min`.
- [x] 2.7 Update the server playbook to keep routine test/check workflows
      disabled after upstream sync, preserve only the fork image workflow, and
      document anonymous pull, digest verification, no-build start, health,
      and rollback.
- [x] 2.8 Run Code Simplifier after the policy/workflow update and record the
      result in `completion.review`.

## 3. Manual validation and review

- [x] 3.1 Manually run the focused tests and relevant static/workflow syntax
      tools for this task. Record results; they are not automatic GitHub gates.
- [ ] 3.2 Assemble one PR from the feature branch to `main`, including the
      already reviewed runtime work and its eligible completed OpenSpec
      archives. Do not submit a CI-only change.
- [x] 3.3 Audit the branch against current `main` and the deployed upstream
      base; document the intentional upstream-aligned tree and omitted legacy
      fork behavior.
- [x] 3.4 Disable or keep disabled all routine test/check workflows in GitHub
      settings and leave only the fork image workflow active. The API now
      reports 26 workflows disabled and only the fork image workflow active.
- [ ] 3.5 Review the actual PR manually before merge, without requiring
      automatic test-status gates.
- [x] 3.6 Confirm auxiliary check YAMLs are manual-dispatch-only and update
      the server playbook to preserve this policy after upstream
      synchronization.
- [x] 3.7 Complete independent low-effort review of the final image-workflow
      policy and implementation; no correctness findings remain.

## 4. Main image and server acceptance

- [ ] 4.1 After merge, verify only the fork image workflow is active. Do not
      enable upstream or auxiliary routine-check workflows.
- [ ] 4.2 Run the first actual native `linux/arm64` main image build and
      candidate-artifact verification. If it fails, preserve exact logs and
      measured evidence and fix through a follow-up PR; do not infer capacity
      fit.
- [ ] 4.3 After the first successful publication, change the GHCR package to
      public in GitHub Packages. Verify anonymous pull and record run URL,
      commit SHA, tags, digest, labels, and result in TODO and
      `completion.review`.
- [ ] 4.4 Before server pull, record current digest, Compose config, health,
      and database-migration state. Pull `:main`, compare its digest and
      labels with the main run, verify ARM64, then run
      `docker compose up -d --no-build`.
- [ ] 4.5 Verify server health, native SQLite, dashboard, and API behavior. On
      failure, restore the prior digest with `docker compose up -d --no-build`
      and verify prior health. Record outcome in TODO and `completion.review`.

## 5. Future maintenance

- [ ] 5.1 If a main build fails, use its logs and measured resource/disk
      evidence to scope a follow-up capacity correction; do not add speculative
      resource limits.
- [ ] 5.2 Before changing the official base, verify its provenance and repeat
      native SQLite, health, API, and official-UI parity checks on the new
      digest.
- [ ] 5.3 Keep automated production deployment separate. Write a new OpenSpec
      package before adding it.
