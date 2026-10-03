# Implementation Tasks

## 1. Manual task checks

- [x] 1.1 Update the manually invoked workflow-policy test to assert that the
      only active automatic image workflow is push to exact main plus manual
      exact-main dispatch, and no automatic test/check workflow triggers on
      feature push, PR, main push, or schedule.
- [x] 1.2 Add focused candidate-verifier tests for architecture, OCI source,
      revision/base labels, SQLite, health/API checks, and exact official-UI
      parity. With `REQUIRE_API_KEY=true`, direct UI listener `20128` returns
      HTTP 401 with `error.code: "AUTH_002"` for unauthenticated
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
- [x] 2.9 Set builder-stage `NODE_OPTIONS=--max-old-space-size=12288` before
      `npm run build:backend` in `docker/official-backend-overlay.Dockerfile`.
      Keep it out of the runtime stage and do not change shared build helpers.
- [x] 2.10 After `npm ci`, set builder-stage `NODE_ENV=production` before
      `npm run build:backend`. Keep the setting in the backend builder; the
      final runtime stage starts from the fresh pinned official base.
- [x] 2.11 Split lockfile dependency installation into `backend-dependencies`
      and derive `backend-builder` from it. Source builds compile backend
      exactly once; selecting `prebuilt-backend` must not pull the compile
      stage merely to get Playwright packages.
- [x] 2.12 Add `runtime-web` from the merged `runtime`: copy only locked
      `playwright` and `playwright-core`, install Chromium and OS dependencies
      plus Xvfb/Xauth, set the browser cache path and ownership, and wrap the
      existing permission-check entrypoint. Declare the official
      `CMD ["node", "dev/run-standalone.mjs"]` in this stage and preserve the
      pinned-base `HEALTHCHECK`.
- [x] 2.13 Configure the main image workflow to build `runtime-web`; make the
      verifier launch non-root Playwright Chromium with `headless: false` on
      `about:blank`, then close it without external requests. Keep UI asset and
      manifest parity checks. The actual main image run remains an acceptance
      task below.
- [x] 2.14 Manually run focused verifier tests and applicable Docker/workflow
      checks for the browser runtime. The browser regression failed before the
      implementation and the focused suite passed 8/8 afterward. Scoped ESLint
      with `--no-ignore`, Prettier, generated-browser-script syntax, and
      `git diff --check` pass. Code Simplifier found no further changes; keep
      all checks out of automatic test workflows.
- [x] 2.15 Declare `CMD ["node", "dev/run-standalone.mjs"]` in `runtime-web`
      after its Xvfb `ENTRYPOINT`. Docker clears a base image's `CMD` when a
      later stage replaces `ENTRYPOINT`; this restores the official server
      launch command. Static image-config review confirmed the selected command
      matches the official launcher; corrected native startup rehearsal remains
      open under task 4.9.
- [x] 2.16 Add focused manual verifier tests first for missing or incorrect
      candidate `User`, `Entrypoint`, and `Cmd`, and demonstrate the failures.
      Then preflight image config before container startup, require exactly
      `USER node`, the expected Xvfb permission-check entrypoint, and
      `CMD ["node", "dev/run-standalone.mjs"]`. Fail before publication and
      report only these allowlisted config fields. Preflight runs before any
      candidate container; diagnostics read only these fields.
- [x] 2.17 Manually run the focused verifier tests after the command fix, run
      Code Simplifier on the implementation slice, and record outcomes in
      `completion.review`; keep checks out of automatic workflows. Focused
      preflight regression was RED before the fix; focused manual tests pass
      9/9. Scoped ESLint `--no-ignore`, Prettier, and
      `git diff --check` pass. Code Simplifier and independent review pass;
      review returned `GREEN[]`.
- [x] 2.18 Add a focused manual regression first: candidate service startup
      arguments include Docker `--init`, while browser checks continue through
      `docker exec` in the started container. Show RED before the fix; then add
      `--init` only to candidate service startup. Run focused tests manually,
      Code Simplifier, formatting/lint, and `git diff --check`; record results
      in `completion.review`. Do not add automatic test workflows. The startup
      regression failed before the fix at the Xvfb-readiness assertion; after
      adding `--init` it passes in the focused suite (9/9). Scoped ESLint
      `--no-ignore`, Prettier, and `git diff --check` pass. Code Simplifier
      retained the single flag and invariant note; independent review returned
      `GREEN[]`. Old-backend disposable fixture differed only by `--init`:
      Xvfb then reached the `node` process and healthy status, UI root returned
      HTTP 200 after redirect, API returned exactly HTTP 401 `AUTH_002`, and
      headed Chromium opened/closed `about:blank` under Xvfb as UID 1000. This
      does not prove the new `runtime-web` artifact; its full native acceptance
      remains open.

## 3. Manual validation and review

- [x] 3.1 Manually run the focused tests and relevant static/workflow syntax
      tools for this task. Record results; they are not automatic GitHub gates.
- [x] 3.2 Assemble the runtime/CI PR from the feature branch to `main`,
      including eligible completed OpenSpec archives. PR #11 merged as
      `3a484460`.
- [x] 3.3 Audit the branch against current `main` and the deployed upstream
      base; document the intentional upstream-aligned tree and omitted legacy
      fork behavior.
- [x] 3.4 Disable or keep disabled all routine test/check workflows in GitHub
      settings and leave only the fork image workflow active. The post-merge
      Actions API reports 29 workflows total, 28 disabled, and only the fork
      image workflow active.
- [x] 3.5 Review the builder-heap correction PR manually before merge, without
      requiring automatic test-status gates. PR #12 merged as `a06fcfb3`.
- [x] 3.6 Confirm auxiliary check YAMLs are manual-dispatch-only and update
      the server playbook to preserve this policy after upstream
      synchronization.
- [x] 3.7 Complete independent low-effort review of the final image-workflow
      policy and implementation; no correctness findings remain.
- [x] 3.8 Complete independent low-effort review of candidate tmpfs and
      cleanup-error handling; no correctness findings remain.
- [x] 3.9 Complete independent static review of the browser-runtime workflow,
      Dockerfile, and verifier changes. No high-confidence correctness findings
      remain; actual native GUI-image proof stays open under task 4.9.
- [x] 3.10 Complete independent review of the explicit-CMD and image-config
      preflight correction. Review result `GREEN[]`: exact default command
      matches the official image, and preflight runs before any candidate
      container while reading only `User`, `Entrypoint`, and `Cmd`. The actual
      main-image startup acceptance remains open.

## 4. Main image and server acceptance

- [x] 4.1 After merge, verify only the fork image workflow is active. Do not
      enable upstream or auxiliary routine-check workflows.
- [x] 4.2 Record first main run `37124029642`: it failed after 4m17 in
      `npm run build:backend` with V8 old-space near 1043 MiB. No image was
      published; failed-run process RSS/cgroup peak and Node version were not
      measured.
- [x] 4.3 Apply the builder-only 12288-MiB Node heap correction through
      manually reviewed PR #12 (`a06fcfb3`).
- [x] 4.4 Record main run `37125217705`: it failed after 6m18 while
      prerendering `/_global-error` with
      `TypeError: Cannot read properties of null (reading 'use')`, followed by
      `Export encountered an error on /_global-error/page`; the Next worker
      exited 1 at about 214.4s. The prior heap-limit error did not recur. No
      GHCR login, publication, or image resulted.
- [x] 4.5 Complete read-only diagnosis of the prerender failure. The Dockerfile
      set `NODE_ENV=development` for `npm ci` and left it set for compilation;
      the installed Next CLI preserved it, and build logs showed React
      development warnings. The exact minified callsite was not isolated.
- [x] 4.6 Record PR #13 (`b6cfc9ad`) and main run `37126849223`: native ARM64
      image build and backend compile completed successfully in about 9 minutes
      (13:38:48–13:47:41 UTC). This verifies compilation passed after the heap
      and production-mode environment changes; it does not mean container
      verification or image publication passed.
- [x] 4.7 Complete read-only diagnosis of the verifier failure. The verifier
      host-bound `/app/data`; container UID 1000 created the cache file and
      runner UID 1001 could not unlink it. A `finally` cleanup can mask a
      primary verification error, so this log does not prove earlier checks
      passed. Record selected tmpfs and error-aggregation correction.
- [x] 4.8 Mount candidate `/app/data` as container-scoped tmpfs mode `1777`,
      preserve image default `USER`, and remove host data bind. Collect cleanup
      errors without replacing primary verification error; fail on cleanup-only
      errors too. Manually test default-user data writes and both error cases;
      focused tests pass 7/7. Scoped ESLint, Prettier, `git diff --check`, and
      Code Simplifier pass. Tests remain manual, outside automatic workflows.
- [ ] 4.9 Complete native candidate artifact verification. Run
      `37129219486` built the candidate in 8m28; verifier message lacked the
      observed response. Latest run `37132155004` completed native candidate
      image build, then observed HTTP 401, `error.code: "AUTH_002"`, and no
      `error.type`; GHCR login/publication did not occur. Diagnosis traced the
      request through client-API auth middleware before the catalog handler.
      The exact auth expectation and summary quoting corrections are manually
      verified, but no `runtime-web` image has passed its browser smoke or the
      full artifact gate. Main run `37138784470` built backend and Playwright
      Chromium, then its healthcheck became unhealthy with
      `172.17.0.3: fetch failed`; logs did not show image command config, and
      API/browser/UI checks were not proven. Static inspection found the
      `runtime-web` stage replaced `ENTRYPOINT` without redeclaring `CMD`; the
      selected fix declares the official server `CMD` and preflights image
      `USER`/`ENTRYPOINT`/`CMD`. The known config defect does not prove the
      observed healthcheck cause. The correction passes focused manual tests
      9/9, scoped ESLint, Prettier, `git diff --check`, Code Simplifier, and
      independent review (`GREEN[]`). The exact-CI-fixture rehearsal before
      Docker init stayed running but unhealthy, so auth/browser checks did not
      run in that attempt. A differential rehearsal on the old-backend
      disposable fixture changed only Docker init: without it, Xvfb stalled
      before Node; with it, the `node` process ran healthy, direct UI root
      returned HTTP 200 after redirect, API returned HTTP 401 `AUTH_002`, and
      headed Chromium opened/closed `about:blank` under Xvfb as UID 1000. This
      does not prove the corrected `runtime-web` artifact. Require a successful
      native main run to pass every artifact check before publication.
- [x] 4.10 Improve catalog-auth assertion failure diagnostics only. Preserve
      the disposable auth fixture and expected 401 gate.
      Report expected status/code, observed HTTP status, and bounded sanitized
      JSON `error.type` / `error.code` only; never log body, headers,
      credentials, model data, or serialized errors. Manually test mismatch
      and unavailable/malformed fields without weakening the assertion.
      Focused manual regressions pass 7/7; diagnostic probe confirms the
      64-character bound, control sanitization, and body/object exclusion.
- [ ] 4.11 After the first successful publication, change the GHCR package to
      public in GitHub Packages. Verify anonymous pull and record run URL,
      commit SHA, tags, digest, labels, and result in TODO and
      `completion.review`.
- [ ] 4.12 Before server pull, record current digest, Docker `HEALTHCHECK`,
      direct UI root response, and database-migration state. Record all three
      active Compose file inputs, final image-digest override, and current
      browser-capable image digest for rollback. Confirm `runtime-web` retains
      Chromium providers before pulling. Verify
      `http://127.0.0.1:20128/` returns HTTP 200; do not probe UI health through
      API proxy port `20129`. Pull `:main`, compare digest and labels, verify
      ARM64, then run `docker compose up -d --no-build`.
- [ ] 4.13 Verify Docker healthcheck, native SQLite, direct UI root, and API
      routes separately. On success, launch Playwright Chromium with
      `headless: false` as non-root on `about:blank` and close it without
      external requests. On failure, restore the prior browser-capable image
      digest with `docker compose up -d --no-build` and verify prior health.
      Record outcome in TODO and `completion.review`.
- [x] 4.14 Replace backtick-containing interpolating `echo` in the published
      image summary with single-quoted `printf` formats and separately quoted
      value args. Manually run summary block with representative public values;
      verify exact source/tag/digest/base/run URL and literal Markdown
      backticks, with no command substitution. The probe preserves all values
      and reports no substitution errors.
- [x] 4.15 Keep the disposable candidate auth fixture at
      `REQUIRE_API_KEY=true` and expect exactly HTTP 401 with
      `error.code: "AUTH_002"` for direct UI `GET /api/v1/models`. Client-API
      middleware rejects before the catalog handler; do not accept arbitrary
      401 or `invalid_api_key`. Manually run focused regression tests; keep them
      out of automatic workflows. The unchanged fixture with the corrected
      expectation gave 3/7 RED before the verifier guard fix and 7/7 GREEN
      after it; scoped ESLint, Prettier, and Code Simplifier passed.
- [ ] 4.16 After successful server deployment and health acceptance, verify no
      build is active, remove the unused dedicated OmniRoute builder, and run
      `docker builder prune --all --force` for the default builder's unused
      cache only. Record measured pre/post cache usage; preserve rollback
      runtime images, databases, volumes, backups, Redis, and unrelated
      services. Do not run image, system, or volume pruning.

## 5. Future maintenance

- [ ] 5.1 If image acceptance fails after the command/preflight correction and
      retry, use exact logs and measured evidence to scope any further
      correction; do not preselect a fix or add speculative resource limits.
- [ ] 5.2 Before changing the official base, verify its provenance and repeat
      native SQLite, health, API, and official-UI parity checks on the new
      digest.
- [ ] 5.3 Keep automated production deployment separate. This scope publishes
      the main image; cutover stays operator-run on the existing Compose host.
      CapRover is a separate host and automatic pull/deploy is not wired. Do not
      imply publishing `:main` updates production. Write a new OpenSpec package
      before adding CD, with agreed host, migration, and credentials.
- [ ] 5.4 Reduce backend build-cache invalidation from broad `COPY .` inputs.
      Metadata-only OpenSpec and completion changes currently enter the build
      context and can invalidate backend compilation. Scope exclusions only in
      a separate reviewed change; do not add speculative exclusions here.
