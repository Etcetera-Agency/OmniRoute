# Implementation Tasks

## 1. RED checks

- [x] 1.1 Add a failing policy test for the workflow boundary: only canonical
      `push` to `refs/heads/main` and manual dispatch with selected ref exactly
      `refs/heads/main` may invoke Docker or backend compilation; PRs and
      feature refs cannot publish or get `packages: write`.
- [x] 1.2 Add focused verifier tests for candidate architecture, OCI source,
      revision and base labels, native SQLite, health/API checks, and exact
      official-UI parity. Assert direct UI listener `20128` returns HTTP 401
      with `error.code: "invalid_api_key"` for unauthenticated
      `GET /api/v1/models`. Keep tests runnable without building a Docker image.
- [x] 1.3 Add a failing Compose/release-policy test requiring the fork's main
      GHCR image, digest verification, `up -d --no-build`, and rollback to a
      previously recorded digest.
- [x] 1.4 Record the existing manifest-merger test as the Docker builder's
      pre-compile gate; if its current invocation or wiring is absent, capture
      that specific failure before changing the Dockerfile.

## 2. Implementation

- [x] 2.1 Implement the local candidate verifier and focused tests. Compare
      `BUILD_ID`, full static tree, page manifest, and every non-API app-path
      entry with the pinned official image; check disposable native SQLite,
      health, dashboard response, and API dispatch.
- [x] 2.2 Update `docker/official-backend-overlay.Dockerfile` to run the
      focused merger test after dependency installation and before exactly one
      backend-only compile. Keep the approved official image digest pinned.
- [x] 2.3 Add `.github/workflows/omni-overlay-image.yml`. PR/feature events run
      only ordinary unit, OpenSpec, workflow syntax, and static checks. Only a
      canonical main push or manual dispatch selected on exact main runs the
      native ARM64 image build and acceptance gates. Do not compile or build
      an image on PR/feature refs.
- [x] 2.4 Give verification jobs `contents: read`; scope `packages: write` to
      the trusted main publisher after all candidate checks. Use only
      `GITHUB_TOKEN`, disable checkout credential persistence, and add no
      Docker Hub, upstream write, server, or production deployment secrets.
- [x] 2.5 Publish the already verified candidate as the full source SHA and
      `:main` tags in `ghcr.io/etcetera-agency/omniroute`. Permit only the
      successful main workflow to write `:main`. Record the actual manifest
      digest, source URL/SHA, base digest, and Actions run URL; do not treat
      the SHA tag as immutable.
- [x] 2.6 Keep BuildKit GHA caching best-effort, ref-scoped, and `mode=min`;
      build correctness must not depend on a cache hit or large cache export.
- [x] 2.7 Update Compose and the fork release guide for the main GHCR image,
      digest verification, operator-run `docker compose up -d --no-build`,
      health acceptance, and rollback to the prior digest. Do not add
      automatic production deployment or server-side source builds.
- [x] 2.8 Run Code Simplifier on the implementation slice and record its
      result in `completion.review`.

## 3. Review and pre-merge checks

- [x] 3.1 Pass the focused unit/policy tests, ESLint, Prettier, workflow
      syntax/actionlint, workflow-security checks, and strict OpenSpec
      validation. The local Docker daemon was unavailable, so image build and
      Docker-backed candidate acceptance remain the post-merge main gate.
- [ ] 3.2 Assemble one PR from the feature branch to `main`, including the
      already reviewed runtime work and its eligible completed OpenSpec
      archives. Do not submit a CI-only PR that omits this work.
- [ ] 3.3 Require review and green PR checks before merge. Confirm PR checks
      do not run Docker/backend compilation, authenticate to GHCR, or publish.
      Before opening the PR, audit the feature branch against current `main`
      and the deployed upstream base; record any intentionally omitted legacy
      fork-only behavior rather than reintroducing it implicitly.

## 4. Main image and server acceptance

- [ ] 4.1 After merge, verify that only the new fork-image workflow is enabled
      if the repository's manually disabled workflows prevent its run. Do not
      activate unrelated upstream workflows.
- [ ] 4.2 Run the first actual native `linux/arm64` build and candidate gates
      on main. If the build fails, preserve exact logs and measured evidence
      and fix through a follow-up PR; do not infer capacity fit.
- [ ] 4.3 After a successful first main publish, change the GHCR package to
      public in GitHub Packages. The workflow leaves visibility unchanged.
      Confirm a pull works without credentials and record the workflow URL,
      commit SHA, tags, digest, labels, and anonymous-pull result in TODO and
      `completion.review`.
- [ ] 4.4 Before the operator-run server pull, record current image digest,
      Compose config, health, and database migration state. Pull `:main`,
      resolve its digest, compare it to the main run, verify ARM64 and OCI
      labels, then run `docker compose up -d --no-build`.
- [ ] 4.5 Verify server health, native SQLite, dashboard and API dispatch. If
      any acceptance check fails, restore the recorded prior digest with
      `docker compose up -d --no-build` and verify prior health. Record the
      outcome in TODO and `completion.review`.

## 5. Follow-up gates

- [ ] 5.1 If a first main build fails, use its retained logs and measured
      resource/disk evidence to scope any capacity fix in a follow-up PR; do
      not add speculative resource limits.
- [ ] 5.2 Before changing the official base after an upstream update, verify
      source provenance and repeat route resolver, full UI parity, native
      SQLite, health, and API-dispatch acceptance against the new digest.
- [ ] 5.3 Automated server deployment remains outside this change. If it is
      selected later, record the server-platform decision and its design in a
      separate OpenSpec package before implementation.
