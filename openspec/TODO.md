# OpenSpec TODO

Deferred scope discovered while preparing the Hermes OmniRoute specs.

## GitHub overlay-image build

- Native acceptance and publication passed on 2026-10-03. Main Actions run
  [`37142905181`](https://github.com/Etcetera-Agency/OmniRoute/actions/runs/37142905181)
  built and verified source `9e6e053efe56fc13ea6d9b106feb18503a9a70a7` from
  `https://github.com/Etcetera-Agency/OmniRoute`, then published the full-SHA
  and `:main` tags to `ghcr.io/etcetera-agency/omniroute`. Both tags resolve
  to manifest digest
  `sha256:671177c97f894c2bebb2da6cc9dadc0b89fc65bc031eeb044862276eb2322c66`;
  pinned base digest is
  `sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`.
  ARM64, SQLite 3.53.4, configured healthcheck, direct UI root HTTP 200,
  unauthenticated direct UI API HTTP 401 `AUTH_002`, non-root headed Chromium
  under Xvfb opening/closing `about:blank`, and full stock-UI parity including
  `BUILD_ID` `FCRnAAEuFvuYgqTcrQCSQ` passed. OCI source/revision/base metadata,
  registry digest, tags, and workflow summary agree.
- GHCR visibility gate passed. The owner temporarily enabled only organization
  public-package creation, switched only `omniroute` to public, then restored
  the organization setting (`Public` off, `Private` on, `Internal` off).
  Credentialless manifest requests for `main` and the exact digest both
  returned HTTP 200; registry `Docker-Content-Digest` and manifest-body
  SHA-256 matched
  `sha256:671177c97f894c2bebb2da6cc9dadc0b89fc65bc031eeb044862276eb2322c66`.
  The full anonymous Docker image pull succeeded; ARM64 and OCI
  source/revision/base labels match the published run. Browser-owner evidence:
  `/tmp/hermes-ghcr-public-20261003.md`.
- The server owner completed the four-file Compose preflight, anonymous image
  pull, and app-only digest-pinned cutover with
  `--no-build --no-deps --pull never`. Health/UI/API/dashboard, SQLite,
  headed-browser, and migration 196 checks passed: 193 numeric rows (maximum 196) plus three preserved legacy rows, with token/request-cost ledgers empty.
  Old browser image and fresh backup remain preserved. Redis container
  identity/health is unchanged. No database migration ran. Full sanitized
  server acceptance and cache-cleanup evidence:
  `/tmp/hermes-omniroute-deploy-acceptance-9e6e053e-20261003.md` and
  `/opt/apps/omniroute-deploy-diagnostics/main-image-9e6e053e-precutover-20261003T182221Z/deploy-acceptance-cache.txt`.
- Authorized cleanup completed after a no-active-build check. The dedicated
  `omniroute-deploy-db18a17` builder was removed, followed by
  `docker builder prune --all --force` for the default builder only. Cache
  changed from 72.35 GB reclaimable to 0 B. Root filesystem used bytes fell
  from `130258251776` to `57239121920`, a measured gain of
  `73019129856` bytes (73.02 GB / 68.02 GiB); dedicated/default cache totals
  overlap and are not additive. No image, system, or volume pruning occurred.
  App and Redis remained healthy, and rollback image plus backup were retained.

- Deferred base provenance: before changing the pinned official base, verify
  its source and digest, then repeat native SQLite, health, API, and official-UI
  parity checks against the replacement digest. Align the root-owned CD
  configuration's accepted base identity with that reviewed replacement.
- Deferred build-context optimization: Dockerfile `COPY .` currently includes
  OpenSpec and completion metadata, so metadata-only edits can invalidate the
  backend compile cache. Keep this separate from the current correction; review
  exact safe exclusions before changing the build context.
- `add-main-image-ssh-cd` server implementation, independent reviews and actual
  host acceptance are complete. Protected canonical Compose inputs, forced SSH
  principal, main-only GitHub environment, digest/source guards, durable systemd
  transaction and app-only cutover are installed. No compatibility shims or
  regular automatic tests were added.
- Real fixture `20261004030000-1` proved automatic startup migration196,
  genuine public404 failure, preserved candidate diagnostic, and restored DB
  SHA equal to the fresh protected backup before prior startup. Backup omitted
  196; candidate contained196. Prior native integrity/FK/full coverage, health
  and private probes passed; Redis stayed unchanged.
- Production current-main smoke `20261004040000-1` survived SSH disconnect,
  completed SUCCEEDED, and reattached through the restricted pinned key with
  canonical SUCCEEDED/run-attempt output. Same-terminal-tuple reattach changed
  neither journal timestamp nor unit/app/Redis identities. Native DB/private
  UI/API/public dashboard checks passed. Backup SHA is
  `d667b6941e6a78549f2e894db99ed635bd98a6bde1cd0606220f8649ced921ae`.
- Server acceptance fixes are complete: resolved effective Compose guards and
  exact no-op dry-run; private in-container20128 probes; isolated internal
  no-publication fixture with temporary loopback404 proxy; owner-correct native
  read-only SQL/live WAL validation; standalone snapshot sidecar invariants;
  canonical terminal entrypoint framing. Review/TDD evidence is in
  `completion.review`. Temporary owned fixture proxy/containers/internal network
  are removed; protected recovery artifacts remain.
- Final pre-commit Code Simplifier checkpoint completed 2026-10-04 for the
  frozen workflow/CI dispatcher diff. No code change was needed; frozen server
  helpers remain unchanged. See `completion.review`.
- Automatic main CD is live: PR18 merged implementation/CI, main run
  `37171754347` published digest
  `sha256:d653f0812ce6f5201713f862d4dbcefb80ee5d151eb93f6909b82cb757525a2b`
  and server transaction37171754347-1 completed SUCCEEDED for source
  `4407a3c1929675b023d55abcf5d0909aa3a6bd23`. Actual image/OCI source,
  canonical override, protected backup SHA and healthy app match; original
  Redis ID remains healthy. Regular automatic tests stay disabled everywhere.
  OpenSpec is archived at `changes/archive/2026-10-04-add-main-image-ssh-cd`;
  new CD and updated image-build living specs are synchronized. This archive
  documentation goes through the same feature→PR→main release path.
  Release rule: after each main merge, wait for image/CD success and confirm
  its matching SUCCEEDED server journal before declaring that revision live;
  record latest source/digest/backup in the OmniRoute server playbook.
- CD backup/failed-database retention needs a separate maintenance policy;
  preserve existing backups, failed candidate diagnostics and rollback images.
  Do not add automatic image, volume, or backup pruning.
- Automatic recovery after a host reboot needs a separate boot-time journal
  recovery procedure. The current CD task survives SSH/runner disconnect;
  transient systemd execution alone does not guarantee reboot recovery.
  Preserve transaction state and snapshots for operator recovery until a
  reviewed boot-time reconciliation policy is implemented.

- PR #11 merged at `3a484460`, heap correction PR #12 at `a06fcfb3`, and
  builder production-mode correction PR #13 at `b6cfc9ad`. Only the fork image
  workflow is active, on a
  main push or manual exact-main dispatch. It verifies the built container
  before publication and has no unit-test gate. Do not run general, unit,
  static, or workflow checks automatically on feature push, PR, main, or a
  schedule. Tests are invoked manually for a specific task. The six earlier
  main attempts failed before publication; successful run `37142905181`
  later closed native artifact verification and publication. PR #13's `NODE_ENV=production` correction
  is on main, and PR #14's tmpfs/cleanup correction passed its focused manual
  tests and independent review. Native ARM64 candidate compilation passes; the
  fifth image verifier run observed HTTP 401 `AUTH_002` with `error.type`
  absent; auth expectation and summary quoting corrections pass manual local
  checks. The `runtime-web` target and non-root browser verifier are
  implemented and reviewed locally; focused browser tests pass 8/8. Sixth main
  run `37138784470` built backend and Playwright Chromium, then the candidate
  healthcheck became unhealthy with `172.17.0.3: fetch failed`; no GHCR login or
  publication occurred, and API/browser/UI checks were not proven. Static
  inspection found that `runtime-web` replaced `ENTRYPOINT` without declaring
  a stage-local `CMD`, which clears the base image's command. The selected
  correction explicitly declares `CMD ["node", "dev/run-standalone.mjs"]` and
  preflights exact `USER`, `ENTRYPOINT`, and `CMD` before starting any candidate
  container. Focused manual tests pass 9/9; scoped ESLint `--no-ignore`,
  Prettier, `git diff --check`, Code Simplifier, and independent review
  (`GREEN[]`) pass. The confirmed missing-command defect does not prove the
  original run's healthcheck cause; its logs omit image command/init config.
  Production uses `HostConfig.Init=true` with `docker-init` as PID 1. A
  controlled old-backend disposable fixture changed only Docker init: without
  init, Xvfb stalled before Node; with init, the `node` process ran healthy,
  UI root returned HTTP 200 after redirect, API returned HTTP 401 `AUTH_002`,
  and headed Chromium opened/closed `about:blank` under Xvfb as UID 1000. This
  isolates init as the difference for that fixture, not proof for the original
  main run or corrected `runtime-web` artifact. Require a successful native
  main run and full artifact verification before publication. Candidate
  service startup now uses `docker run --init` only; browser smoke remains
  `docker exec` inside that container. The focused startup regression was RED
  before the flag and the suite passes 9/9 after it; scoped ESLint, Prettier,
  `git diff --check`, Code Simplifier, and independent review (`GREEN[]`) pass.
  At run `37138784470`, final native image, browser, and publication gates
  remained open; run `37142905181` later passed those native gates.
- Final manual verification passed 13/13 focused tests, scoped ESLint,
  Prettier, actionlint (0 findings), the full workflow audit (209 findings
  against a baseline of 233), and `git diff --check`. Independent low-effort
  review found no correctness findings. Code Simplifier reviewed the final
  trigger/job policy and test-gate removal; no further simplification was
  needed. OpenSpec validation passes strictly (7/7). These manual test and
  audit results preceded the builder environment corrections. At that
  checkpoint, no local image build or production change had occurred.
- First main image run `37124029642` failed after 4m17 in
  `npm run build:backend` with repeated V8 ineffective mark-compacts and
  allocation failure at an effective old-space limit near 1043 MiB. No image
  was published. The Dockerfile had no `NODE_OPTIONS`; the build helper only
  defaults to 8192 when no option is inherited, so the official base's
  inherited option prevailed. The failed run has no process RSS/cgroup peak or
  Node-version measurement; do not claim those values.
- The first-run correction set the builder only to
  `NODE_OPTIONS=--max-old-space-size=12288` in the backend build stage before
  `npm run build:backend`. Do not change the shared helper or final runtime
  stage. This matches a prior successful remote compile of the same backend
  with a 12-GiB heap and about 15.72-GB measured peak, against the public ARM64
  runner's stated 16 GB. PR #12 contains this adjustment. Main run
  `37126849223` later completed native ARM64 backend compilation with this
  setting; that run does not guarantee future builds or artifact acceptance.
- Second main image run `37125217705`, after PR #12, failed after 6m18 while
  prerendering `/_global-error`. Next reported
  `TypeError: Cannot read properties of null (reading 'use')`, then
  `Export encountered an error on /_global-error/page`; the Next worker exited
  1 at about 214.4 seconds. The prior V8 heap-limit error did not recur. The
  workflow did not log in to GHCR or publish an image. Read-only diagnosis
  found that the Dockerfile set `NODE_ENV=development` for `npm ci` and left it
  set during backend compilation; the installed Next CLI preserved it, and
  build logs showed React development warnings. The exact minified callsite was
  not isolated. Selected correction: set builder-only
  `NODE_ENV=production` after `npm ci` and before `npm run build:backend`; the
  fresh runtime stage remains unchanged. This corrects observed build state
  without claiming the exact null-`use` callsite is known. The next main run
  passed compilation; the artifact gate failed as recorded below.
- PR #13 (`b6cfc9ad`) set builder-stage `NODE_ENV=production` after `npm ci`
  and before `npm run build:backend`. Third main run `37126849223` completed
  native ARM64 candidate image build and backend compile in about 9 minutes
  (13:38:48–13:47:41 UTC); the previous heap and prerender compile failures did
  not recur. This does not establish full artifact acceptance.
- Run `37126849223` then failed in `verify-official-overlay-image` while
  unlinking `/tmp/omni-overlay-data-uR7ulC/cache/openrouter-provider-stats.json`
  with `EACCES: permission denied`. Read-only diagnosis found the cause:
  container `/app/data` was a host temp-directory bind mount; image default
  user `node` (UID 1000) created the cache file, and runner UID 1001 could not
  unlink it. Cleanup in `finally` may also have masked a primary verification
  error, so the log does not establish whether earlier checks passed. The
  selected fix mounts `/app/data` as container-scoped tmpfs mode `1777`, keeps
  image default `USER`, and collects cleanup errors without replacing primary
  verification errors. Cleanup-only failure still blocks publication.
  BuildKit GHA cache export succeeded in 25.3 seconds. GHCR login and
  publication were skipped; no image was published. The fix is implemented in
  the local verifier, and focused manual tests pass 7/7. Scoped ESLint,
  Prettier, `git diff --check`, and Code Simplifier pass. Independent
  low-effort review found no correctness findings; no broader test-suite rerun
  is claimed. At this checkpoint full main artifact acceptance remained open;
  later run `37142905181` passed and the server acceptance record below closes
  the rollout. No server pull or deployment had occurred at that checkpoint.
- PR #14 (`4d652048`) includes the tmpfs and cleanup-error correction. Main
  run `37129219486` completed native candidate build in 8m28; the previous
  `/app/data` EACCES did not recur. The verifier then failed the assertion
  `/api/v1/models must return 401 invalid_api_key without credentials`. It did
  not record status or error fields; the run is inconclusive for the
  endpoint response. Run `37132155004` completed native candidate image build,
  then the verifier observed HTTP 401, `error.code: "AUTH_002"`, and no
  `error.type`. GHCR login/publication were skipped; no image was published.
  Read-only call-path diagnosis traces `classify.ts:95` -> `proxy.ts:23` ->
  `runAuthzPipeline` -> `clientApi.ts:61`: the request is rejected by the
  client-API auth middleware before the catalog handler, and `pipeline.ts:62`
  emits code without `error.type`. This is expected with
  `REQUIRE_API_KEY=true`; the prior `invalid_api_key` prediction missed this
  middleware path. Keep the API key required and assert exactly HTTP 401
  `AUTH_002`; do not accept arbitrary 401 or the unreached handler's code.
  Safe failure diagnostics remain bounded to observed HTTP status and
  sanitized JSON `error.type` / `error.code`, without body, headers,
  credentials, models, or serialized errors. Manually verify the fixture
  correction before the next main acceptance. The auth-fixture correction
  returned 3/7 RED before the guard fix and 7/7 GREEN after it. Scoped ESLint,
  Prettier, Code Simplifier, and summary shell probe passed. At that checkpoint,
  package visibility, anonymous access, and server acceptance remained open.
- The final Actions summary had a shell quoting defect: literal backticks
  inside double-quoted `echo` strings caused seven command substitutions and
  missing source, tag, digest, base, and run URL values while the block exited 0.
  The workflow now uses single-quoted `printf` formats with separately
  quoted public values. A manual shell probe confirms every value and literal
  Markdown backticks are preserved with no substitution errors.
- Current production browser layer is confirmed from the non-secret staged
  browser Dockerfile: Compose's third browser override runs
  `omniroute:55f40468-official-overlay-web-browser-20261003`; it copies locked
  Playwright packages, installs Chromium and OS dependencies at
  `/home/node/.cache/ms-playwright`, and wraps the permission-check entrypoint
  in Xvfb. The chosen fork image adds a shared `backend-dependencies` stage,
  derives `backend-builder` from it, and adds `runtime-web` from merged
  `runtime`. It copies only locked Playwright packages, installs Chromium,
  Xvfb and Xauth, preserves official UI and permission check, explicitly
  redeclares `CMD ["node", "dev/run-standalone.mjs"]` after the Xvfb
  `ENTRYPOINT`, and inherits the pinned-base healthcheck. Preflight exact
  `USER node`, entrypoint, and command before starting the candidate. Build the
  CI candidate with
  `--target runtime-web`; verify non-root headed Playwright Chromium opens
  `about:blank` and closes without external requests. Keep the prebuilt-backend
  path independent of backend compilation for browser packages. Before server
  cutover, reconcile all three active Compose inputs and the final digest
  override; record the current browser image digest as rollback. Do not pull or
  cut over until the main candidate passes browser and all other artifact
  checks. After successful deployment, the authorized cleanup removes the
  isolated dedicated builder and prunes unused default-builder cache only;
  record actual reclaimed space and retain the prior runtime image. Do not
  prune images, the system, or volumes.
- On GitHub, keep the auxiliary `api-route-typecheck.yml`,
  `test-quarantine.yml`, and `release-acceptance.yml` workflows manual-only.
  Keep all remaining routine check workflows disabled in repository settings;
  preserve only the fork image workflow as active. The deployment playbook now
  instructs operators to keep routine checks disabled after upstream sync.
- GitHub settings update completed: before merge, the Actions API listed 27
  workflows, with 25 upstream workflows already disabled and API Route
  Typecheck plus the fork image workflow active. API Route Typecheck was
  disabled; after merge, the current API reports 29 workflows total, 28
  disabled, and only the fork image workflow active. Feature push run
  `37121740387` and PR run
  `37121831813` from the old automatic checks were cancelled. API typecheck PR
  run `37121831856` had completed before its workflow was disabled. The merged
  source YAML makes the three auxiliary workflows manual-only. Preserve this
  settings state after every upstream sync; do not enable unrelated workflows.
- The six earlier main attempts failed before publication. Successful run
  `37142905181` later passed native artifact verification and published. The
  sixth built
  `runtime-web` and Playwright Chromium but failed Docker healthcheck; no API,
  browser, or UI acceptance is proven. Exact-CMD declaration and config
  preflight now pass focused manual tests 9/9, scoped lint/format/diff checks,
  Code Simplifier, and independent review (`GREEN[]`). The old-backend Docker
  init differential passes health, direct UI/API, and headed-browser checks as
  detailed above. At that historical point, browser smoke on the new
  `runtime-web` image and remaining artifact checks were open; run
  `37142905181` later passed the native artifact gate.
- Record the successful run URL, full source SHA, pinned official base digest,
  full-SHA and `:main` tag equality, registry manifest digest, OCI
  source/revision/base labels, and run-summary consistency here and in
  `completion.review`. The manifest digest is image identity; do not assume
  SHA tags are immutable. Preserve real capacity evidence without inferring
  fit from runner specifications.
- Publication and public visibility are complete. Organization
  public-package creation is restored to disabled; credentialless manifest
  access and full anonymous Docker pull are verified. Durable server-owner
  evidence is in `/tmp/hermes-omniroute-deploy-acceptance-9e6e053e-20261003.md`
  and `/opt/apps/omniroute-deploy-diagnostics/main-image-9e6e053e-precutover-20261003T182221Z/deploy-acceptance-cache.txt`.
  The workflow does not change package settings and no server pull credential
  is used.
- Read-only server readiness check reports the configured Docker healthcheck
  (`CMD node healthcheck.mjs`) healthy and direct UI
  `http://127.0.0.1:20128/` returning HTTP 200. Prior 404s came from probing a
  health path through API proxy port `20129`; this is not a stale UI route.
  This was a pre-cutover readiness snapshot; the completed candidate deployment
  and acceptance are recorded above. The operator-run pull compared digest,
  labels, and ARM64, preserved Compose state, verified Docker health, native
  SQLite, dashboard, API, and browser behavior, and recorded migration state.
  The API response on direct UI listener `20128` was HTTP 401 `AUTH_002` with
  `REQUIRE_API_KEY=true`. No migration ran. The rollback command remains the
  documented recovery path; it was not invoked because acceptance passed. The
  workflow did not connect to production or run migrations at that CI-only
  checkpoint. The separately requested `add-main-image-ssh-cd` package adds
  automatic deployment and snapshot-based migration recovery.
- Fresh main archive is pushed and verified: `archive/main-before-main-image-pr-2026-10-03` points to `f2bddef27ed0807dd5a5e2712bc26536edda8138`; `main` remained at that SHA through the pre-integration fetch. The feature records this `main` history with an ours-strategy merge, preserving the reviewed upstream-aligned source tree; the broad upstream delta and retired fork behavior are described in the PR. Do not restore old fork behavior without an explicit reviewed requirement.
- Pre-PR audit completed against current `main` `f2bddef27ed0807dd5a5e2712bc26536edda8138`, pre-integration feature `11a54874b7e236df5935e54f17a7ffcb5564d88d`, and deployed runtime `55f40468137290e8efdc24a1a1b95b111a61d91a`. The reviewed feature tree intentionally follows official OmniRoute upstream v3.8.52 (`23a11484862b3bb589a55e85b00e4ac53ffeb234`). Its PR diff against `main` is intentionally broad: 17,350 paths (+4,914,997/-536,172), replacing the stale fork tree with the upstream-aligned source plus reviewed overlays. Against the selected upstream release, the overlay is 88 paths (+16,137/-151). Inventory found no generated build/cache/dependency outputs; environment files are examples, and no private-key, certificate, or database artifacts were found. All 98 tracked blobs larger than 1,000,000 bytes are byte-identical to the upstream release. The tree retires legacy fork-only web-fetch/search/routing/FMO behavior. Do not restore old fork behavior without an explicit reviewed requirement.
- Initial GitHub settings review found Actions enabled, all actions allowed,
  default workflow token permission `write`, and no main branch protection or
  repository/inherited rulesets. The image workflow declares scoped
  permissions. Package `omniroute` has since been published and set public;
  organization public-package creation is restored to disabled. Manifest-level
  credentialless access and full anonymous Docker pull are verified; durable
  server-owner evidence is linked above. Public visibility cannot be reverted to
  private.
- For any later hosted-build failure, preserve exact logs and measured
  resource/disk evidence before scoping a correction through a follow-up PR.
  Do not invent memory, swap, process, disk, or build-time limits. Reverify
  upstream provenance and overlay compatibility whenever the official base
  digest changes.
- Automated production deployment is now scoped in
  `openspec/changes/add-main-image-ssh-cd`: GitHub Actions over restricted SSH
  to `etc2nd-shlink`, automatic migrations, and snapshot/previous-image
  recovery on failure. Implementation and live acceptance are in progress.

## Deferred Items

- Active FMO pool migration slices from the 2026-07-01 concept audit:
  `fix-fmo-pools-live-seam` is implemented with focused unit coverage and a documented
  deploy smoke in `docs/fmo-pools-live-seam-smoke.md`; production cutover validation
  still must run that smoke through the live bridge before marking the broader pool
  migration complete. `fix-fmo-pools-solver-contract` is implemented with focused unit
  coverage for canonical quality categories, symmetric band relax, runtime/manual
  `customModels` inventory, and hidden-model visibility gates. Do not mark the pool
  migration complete until live cutover smoke passes.

0. Keep FMO pool extractor live-provider coverage pending until an internal
   extractor model is configured for this fork. Unit coverage now verifies the
   in-process `handleChatCore` contract, parser, disable path, and tier-4
   snapshot retention.
1. Keep `add-fmo-pools-planning` live extractor validation pending until this fork
   has a configured, cheap, JSON-reliable quota extractor model. The server-side
   search chain, snapshot/evidence retention, in-process `handleChatCore` extractor,
   parser, and deterministic validator are implemented; remaining work is live
   provider coverage only.

2. Keep the daily model-manager routine in the Hermes repo. OmniRoute only supplies management APIs, routing behavior, telemetry, and provider support consumed by that routine.
3. Prepare an upstream OmniRoute PR after the fork changes stabilize:
   - Mdream web-fetch executor.
   - Extensible web-fetch provider registry.
   - Configurable fetch provider priority.
   - Sequential web-fetch fallback.
   - Cooldown and circuit-breaker integration.
4. Keep Hermes browser fallback out of first version. Firecrawl remains the final provider for JavaScript rendering, screenshots, selector waiting, and deeper crawl options.
5. `gemini-grounded-search` is now tracked as its own OpenSpec change. Keep it separate from generic search provider ordering.
6. Additional provider candidates are tracked in `add-additional-search-providers`; implement in batches, not all at once.
7. Mdream live endpoint check on 2026-06-15 showed `https://mdream.dev/p/<url>` returns the Nuxt UI shell, while `https://mdream.dev/<host/path?query>` returns raw markdown. Keep the executor on the verified raw endpoint unless Mdream publishes a stable raw API that preserves URL scheme.
8. `mcp-omnisearch` review on 2026-06-15 found reusable MIT-licensed patterns worth adapting later: provider registration with missing-key status entries, compound `provider:mode` IDs for extract modes, schema-validated provider responses, shared retryable error classification, and configurable Firecrawl v2 base URL. Do not copy its implementation wholesale; port only logic that fits OmniRoute contracts.
9. Verify Mdream and Parallel Extract rendering in `/dashboard/search-tools` after the provider UI supports the shared `parallel` connection. API catalog integration is covered now; visual dashboard verification remains deferred.
10. Fix existing MDX frontmatter in `docs/security/SUPPLY_CHAIN.md`: `npx playwright test tests/e2e/search-tools-studio.spec.ts` cannot start its webServer because Fumadocs rejects the document with `title: Invalid input: expected string, received undefined`. This blocks dashboard E2E verification for routing UI until the docs source is corrected.

## Auto quality bands

Before completing the later band-filter/reserve packages and enabling production routing:

- Run a safe successful chat-path check for `auto/coding_high` and `auto/coding_high:free`, then confirm `call_logs.combo_name` retains the full requested id. Local contracts prove the resolver preserves the id and the virtual-combo wrapper copies it to `name`/`id`; they do not execute a successful chat request or inspect a resulting log row.
- The local kill-switch contract covers an enabled request followed by a fresh disabled request. When the reserve slice lands, also verify its narrowing hook is bypassed after the flag is disabled and that each candidate's `allowedConnectionIds` remains unchanged.
- Verify band `thrifty` candidates are ordered `free → keyless → subscription → cheap → premium`, without the ordering itself excluding a candidate for quality or economic class; preserve the confirmed upstream `:free` provider/model behavior for eligible keyless OpenCode models.
- If a future Hermes role requires a per-connection zero-spend guarantee, define that as separate scope: current `:free` classification is provider/model-level and does not distinguish an optional API-key OpenCode connection from its no-auth connection.
- Verify the `virtualFactory.ts` account hook removes reserved connection IDs from `allowedConnectionIds` before rung ordering and dispatch, keeps a candidate while at least one account remains, and removes it when none remain.
- Keep the existing-source change set limited to the band seam in `suffixComposition.ts` and `virtualFactory.ts` plus its band-scoped selector extension in `resolveAutoStrategy.ts`; ordinary upstream routing remains unchanged.
- The pinned official Node 26 UI image plus reviewed backend-only API overlay (`package.json` supports `>=24 <27`) passed candidate build/start and migration acceptance against a fresh production-data copy. Node 24 portability remains a separate baseline, not a production blocker; OpenSpec task 1.4 stays unchecked for that portability smoke. Authenticated `/v1` dispatch and enabled SystemOne/band routes remain unverified.
- Two Node 26 builds of staged commit `db18a17c374506941d10fbc58132eb108d1ea5db` failed. Attempt 1 ran 02:57:04–03:08:36 UTC with a 7 GiB total RAM/swap bound, cpuset 0, and pids limit 512; `npm run build` exited 1 at webpack step 19 and builder inspection reported `OOM=true`. Attempt 2 ran 03:26:10–03:34:11 UTC with the supported 4096 MiB heap argument, the same container/resource bounds, and cached dependencies. It exited 1 after V8 heap exhaustion near 4066 MB and `SIGABRT`; there was no new cgroup OOM event. Logs and diagnostics from both attempts were retained. Neither produced an image or caused production migration/cutover; at that time, production remained at `f2bddef27ed0807dd5a5e2712bc26536edda8138`.
- Third diagnostic build for staged `db18a17c374506941d10fbc58132eb108d1ea5db` ran 03:49:15–03:58:53 UTC and exited 1 as `CANCELED` / `context canceled`, not OOM. The watcher expected an exact 9-GiB container value, misclassified an approved 9.5-GiB same-container resource update as a builder replacement, and canceled the build. Logs were retained; this is a watcher guard defect, not an application compatibility issue. Production `f2bddef27ed0807dd5a5e2712bc26536edda8138` and its DB remain untouched; no image was produced.
- Retry 4 for staged `db18a17c374506941d10fbc58132eb108d1ea5db` ran 04:03:26–04:12:29 UTC after preflight reported 27,403,431,936 bytes free disk and 15,284,174,848 bytes `MemAvailable`. It used the approved 10-GiB limit, heap 6144 MiB, two workers, webpack, cpuset 0, pids 512, and 900 seconds. A cgroup OOM event occurred at 04:12:22 UTC; the Next worker was SIGKILLed at 535 seconds and memory peaked at 9.999/10 GiB. Kernel evidence showed one Node MainThread at 10,220,928 KiB anonymous RSS and 0 file RSS; cgroup memory was 10,665,197,568 bytes anonymous and about 1 MiB file-backed. Read-only local diagnosis found `webpackBuildWorker=1`, `webpackMemoryOptimizations=true`, and Next filesystem cache `maxMemoryGenerations=Infinity`; CPU/page-worker settings are already minimal. No image/start/cutover/migration resulted; at that time, production remained at `f2bddef27ed0807dd5a5e2712bc26536edda8138`.
- Historical evidence from the deployed [`DOCKER_GUIDE.md`](../docs/guides/DOCKER_GUIDE.md) records the old f2 Node 26 full-UI webpack `runner-base` build passing at a 12-GiB cap (11.1-GiB peak), with heap 6144 MiB and two workers; 8 GiB failed. Retry 5 repeated that profile on staged db18 and OOMed, so the historical pass is version-specific and the resource workaround alone is insufficient for this revision.
- Retry 5 for exact staged SHA `db18a17c374506941d10fbc58132eb108d1ea5db` ran 07:44:15–07:55:48 UTC. After the approved OmniRoute-only stop, post-stop guards passed at 14.741 GiB RAM and 25.519 GiB disk; the read-only watcher dry run passed. The pinned Node 26 Compose `runner-base` build used 12 GiB total, cpuset 0, pids 512, heap 6144 MiB, two workers, and `OMNIROUTE_USE_TURBOPACK=0`; timeout was 840 seconds. A new cgroup OOM event occurred at 07:55:44 UTC and the Next worker was SIGKILLed at 687.8 seconds; build exited 1 at 07:55:48 UTC with no candidate image. The 900-second restoration watchdog remained armed through recovery. The prior exact f2 container returned healthy at 07:56:19 UTC; OmniRoute outage was 12m04s, within the approved 15-minute limit. Redis stayed healthy; no DB/Radar changes or cutover occurred. Production remains at `f2bddef27ed0807dd5a5e2712bc26536edda8138`.
- User decision resolved: set production `cache.maxMemoryGenerations=0` constantly, without a feature flag. The setting is implemented, reviewed, and published in source commit `4b29aa12fcc51fb183b196b67f878fb8ca67b5b2`; its callback smoke and `node --check` passed. Webpack documents that `0` disables additional memory-cache generations but retains data until disk serialization and does not bound the live compiler object graph, so it cannot guarantee the 12-GiB build will fit ([cache docs](https://webpack.js.org/configuration/cache/#cachemaxmemorygenerations)). Next 16.3.5 sets production `Infinity` before the custom callback; after every Next/framework upgrade, verify callback order reapplies `0`. Retry 5's failed full-UI build is historical RED evidence; it is not a gate for the official-UI/backend-overlay deployment.
- Full-UI cache follow-up: The published candidate uses the attested official UI image plus a backend-only overlay. `maxMemoryGenerations=0` behavior was exercised on that backend-only compile; its effect on a full-UI webpack build and a 12-GiB full-build fit remain unmeasured. Do not claim the cache setting makes full-UI builds fit. If a future delivery requires rebuilding the dashboard, measure the full target in a separately approved follow-up.
- OpenSpec archival completed for `reduce-production-webpack-cache-memory` and `add-official-image-backend-overlay`. They are archived at `openspec/changes/archive/2026-10-03-reduce-production-webpack-cache-memory/` and `openspec/changes/archive/2026-10-03-add-official-image-backend-overlay/`; their deltas are merged into `openspec/specs/production-webpack-build-memory/spec.md` and `openspec/specs/official-image-backend-overlay/spec.md`. Final strict validation passed for living specs (2/2) and the four remaining active changes (4/4); both archived targets passed their focused validation. The cache-spec audit fixed missing `Purpose` and `Requirements` headings before validation passed. Four active packages remain: the three auto-quality-band changes and the SystemOne change; keep them open until their operational gates pass.
- Backend-overlay rollout status (2026-10-03): the official Node 26 / Next 16.3.5 linux/arm64 base for upstream `23a11484862b3bb589a55e85b00e4ac53ffeb234` passed native and filesystem inspection at `sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`; its SLSA attestation binds the source, and OCI revision/version labels are absent. Source A `4b29aa12fcc51fb183b196b67f878fb8ca67b5b2` compiled successfully in 733.7 seconds. The full scratch export was canceled at 09:16:03 UTC because it was exporting unneeded cache data, not because compilation failed. The cached thin export completed in 1.6 seconds: 232,614,811 bytes total, including 3,529 server files / 232,234,534 bytes, a 193,684-byte routes manifest, and a 27,866-byte required-server-files manifest; it contains no standalone app, static assets, cache, or node_modules. Thin-export and route/bundle hashes were verified against the final image; an aggregate artifact/image digest was not reported.
- Source B `55f40468137290e8efdc24a1a1b95b111a61d91a` produced the candidate tag `omniroute:55f40468-official-overlay` from the pinned base and prebuilt backend pack. BuildKit parse and image import passed without recompiling. Native checks passed for Node 26.10.0, Next 16.3.5, and SQLite 3.53.4. All 1,089 static assets, the Next build-identifier file, and 159 non-API app-path entries match the base hashes; the merged manifest has 725 API routes, 9 API function configs, and 16 rewrites. Source A plus pack B runtime compatibility was verified. The candidate container was healthy and `/dashboard/radar` returned 200. SystemOne paths returned handler-specific `unknown_route` 404 only with both feature and auth disabled; this is not an enabled-route test. A fresh production-data copy passed integrity/FK checks, exact ledger rekey, candidate migration/start/idempotence, and unauthenticated `/v1/models` auth handling. Authenticated `/v1` dispatch and enabled/authenticated SystemOne and band routes remain pending. The copy's Radar probe returned 404 with Radar disabled.
- Production now runs `omniroute:55f40468-official-overlay`, image ID `sha256:bfb397b394e6f646583355dbe26bbb879cca2efddef140f786558519eedc4668`, from source B `55f40468137290e8efdc24a1a1b95b111a61d91a` and runtime-equivalent backend artifact A `4b29aa12fcc51fb183b196b67f878fb8ca67b5b2`. The candidate is healthy; Redis is healthy, and 33 migrations applied successfully. The authorized three-row production ledger rekey followed a fresh 112,594,944-byte backup at `/opt/apps/omniroute-deploy-diagnostics/prod-cutover-55f40468-20261003T095314Z/backup/storage.sqlite` (SHA-256 `d2c5149efb1272edadb09b5ba93378986f71f3943373ee5783dad9f728c901a6`) that passed `quick_check`. Current DB `quick_check` is `ok`, foreign-key violations are zero, ledger has 196 rows (193 numeric and three legacy) with max numeric version 196, upstream 164–166 are present, preserved legacy names/timestamps match, retirement triggers are present, and FMO table counts are 5/45/1/1. Unauthenticated production `GET /v1/models` returned expected `401 AUTH_002`. `RADAR_ENABLED` and public-catalog opt-in are true; authenticated settings/status calls returned HTTP 200. Public dashboard [Radar page](https://omniroute.etc2nd.etcetera.agency/dashboard/radar) redirects to login when unauthenticated (HTTP 200). Sync returned HTTP 200, but status reported `Feed request failed with status 404`; all four Radar caches remain empty. `RADAR_FEED_URL` is unset, so the client uses `https://radar.omniroute.online`; `GET /v1/catalog/latest` returns Vercel `deployment-not-found` even with the correct schema header and without requiring a bearer token. The 489 built-in catalog entries do not prove a Radar feed was loaded. Root cause is the unavailable external Radar deployment/domain, not OmniRoute routing or credentials. This repo has no private Radar service source/access, only its public export workflow. The supporter Intel key remains a separate user dashboard action and does not resolve this endpoint failure. Other authenticated routes, real-catalog calibration/routing/reserve, and live SystemOne checks remain pending. Task 1.4 stays unchecked for the separate Node 24 portability smoke.
- Remaining rollout work: restore the external Radar service/domain or configure `RADAR_FEED_URL` to a verified live endpoint, then sync and verify public feed/cache; complete authenticated `/v1` dispatch and enabled/authenticated SystemOne and band route smoke; then run real-catalog calibration, band routing, reserve, and SystemOne live checks. The user will enter the supporter Intel key through the dashboard as a separate post-deploy action. Revalidate the pinned base digest/attestation and overlay behavior on every Next upgrade.
- The fresh production-data copy rehearsal and production migration checks passed the three-row ledger rekey, candidate migration/start, integrity and foreign-key checks, and idempotent startup. FMO schema, rows, names, timestamps, and hashes remained unchanged; details are in [the FMO migration ledger rehearsal](../docs/ops/AUTO_BANDS_MIGRATION_REHEARSAL.md). The production migration and cutover have been performed; preserve the protected backup and finish authenticated route and Radar/live checks. Permanent migration compatibility code remains forbidden.
- Preserve the verified migration-history correction: fork IDs 164–166 are `fmo_pools`, `fmo_pool_decisions`, and `fmo_pool_live_seam`; upstream has `retire_microsoft_designer_web`, `retire_felo_web`, and `retire_gpl_derived_providers` at those IDs. The upstream runner reconciled a rename from 163 to 169 and warned that version-only tracking can skip and rerun a migration. The copy repair procedure and completed production migration are documented in [the FMO migration ledger runbook](../docs/ops/AUTO_BANDS_MIGRATION_REHEARSAL.md). Deployment and migration are complete; do not repeat the ledger rekey. Permanent migration mapping/compatibility code is forbidden.
- Separate FMO orphan cleanup is a future destructive operation, not part of the current migration/cutover. The reviewed source A/pack B and upstream `23a1148` contain no runtime references to the FMO tables; the preserved copy contains `fmo_pool_specs` (5 rows), `fmo_pool_decisions` (45), `fmo_pool_apply_marker` (1), and `fmo_pool_generation_marker` (1). The rehearsal proves preservation only. Before dropping these four tables or their three legacy ledger rows, run a deletion rehearsal on a disposable copy, validate restore/rollback, and obtain explicit deletion approval. Do not drop them during the current maintenance.
- The billing-rung selector carries exact provider/model/account assignments through the real Auto selector and fallback list. A quota-cutoff-blocked free account could previously outrank routable premium; the band path now keeps blocked accounts after all routable rungs. Review closed both routing findings and confirmed the existing 429 when every candidate is blocked. Routing tests pass 7/7, and direct upstream resolver/stream/quota tests pass 27/27.
- Final local Auto-Combo and service validation passes 41 files / 372 tests, including calibration; core and OpenSSE typechecks pass. Before calibration, the Auto-Combo-only suite passed 40 files / 353 tests. Scoped evidence includes calibration 19/19, quality E2E 4/4, reserve source tests 25/25 across three suites, reserve account-routing E2E 4/4, config 13/13, capabilities 8/8, filter 8/8, routing 7/7, and direct upstream resolver/stream/quota tests 27/27. Independent reviews closed the quality hook, reserve config/capacity/integration, calibration, and both routing findings. ESLint, Prettier, and `git diff --check` pass for the reviewed slices.
- The fork release/deployment guide is documented in `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md` and linked from README and `docs/ops/FLY_IO_DEPLOYMENT_GUIDE.md`; SystemOne environment/API/OpenAPI references are updated. Candidate image `omniroute:55f40468-official-overlay` is serving after the authorized cutover; its container and Redis were healthy at 09:58 UTC. Copy migration/start, production ledger rekey, integrity, foreign-key, trigger, and FMO-count checks passed. Authenticated route smoke, Radar public feed/cache, real-catalog calibration, band routing, reserve validation, and SystemOne live gates remain open. Radar opt-in is true, but the default feed endpoint returns Vercel `deployment-not-found`, producing sync status `Feed request failed with status 404`; all four caches remain empty. Restore the external service/domain or configure a verified feed URL before retrying.
- The user approved nearest-rank calibration over sorted distinct numeric score values from observed rated models: `c1 = scores[ceil(0.33*N)-1]`, `c2 = scores[ceil(0.67*N)-1]`, where `N` is the number of distinct values; for nine different values, use the third and seventh. The rule is written in the quality design/spec. Calibration implementation, report CLI, five independently reviewed fixes, and local tests are complete. The local isolated-DB CLI smoke returned valid JSON for 10 baseline models, 0 rated models, and no cut points; it does not validate the live catalog. Keep the real-catalog report and production calibration run open.
- The enabled band selector now fails closed when a built Auto candidate lacks an exact provider/model/account mapping. `expandPromptCacheAffinityTargetsFromConnections()` can preserve a logical target with `connectionId: null` when the current active-account intersection is empty; dispatch forwards its allowlist and credential selection rechecks it, but a cache-time change could otherwise let dispatch choose an arbitrary account from a multi-account allowlist. The regression covers the null target, and the explicit allowlist remains authoritative over a stale direct pin: retain allowed account B and never route direct account A. The reviewer verified these routing constraints and the quota-cutoff terminal fallback; ordinary upstream routing remains unchanged.
- Correct the quota snapshot API contract in a separate upstream-contract slice. `getQuotaSnapshots()` returns camelCase fields (`connectionId`, `windowKey`, `remainingPercentage`, `nextResetAt`, `createdAt`), with `isExhausted` represented as numeric `0 | 1`; exported `QuotaSnapshotRow` still declares snake_case fields. The reserve slice uses a local strict camelCase boundary and does not add a dual-shape shim. Correct the getter/type declaration later, then remove the local boundary cast only after a runtime-backed contract test passes.
- Calibration implementation and report CLI are complete and locally reviewed. The production Radar flag and public-catalog opt-in are true. Authenticated settings/status probes returned HTTP 200; a public sync request returned HTTP 200 but status reports `Feed request failed with status 404`. The default `GET https://radar.omniroute.online/v1/catalog/latest` returns Vercel `deployment-not-found` with the correct schema header and without a bearer token; all four feed/intel/offers/referrals caches remain empty. This repository contains no private Radar server source/access, only the public export workflow. Restore the external service/domain or configure a verified live `RADAR_FEED_URL` before retrying public sync. The 489 built-in catalog entries are not evidence that feed data loaded. The supporter Intel key is absent; the user will enter it through the dashboard as a separate post-deploy action, not as a prerequisite for public activation or a fix for the undeployed feed endpoint. Public/community catalog access is keyless. Bands continue to use Arena/manual rated sources; Radar Intel scores remain separate and are not mapped to `getTaskFitnessWithSource`. After sync succeeds, confirm feed version/fetch time and cache population, inspect the authenticated status for other caches without requiring supporter-only feeds, then run the report on the real catalog and record rated-source coverage, structured-output capability coverage, and candidate counts for every Hermes channel before enabling enforcement.
- Confirm `OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL` is unset and band candidate pools remain non-empty with enforcement enabled.
- Before enabling demand reserve, compare usage provider/model IDs with catalog IDs and measure the 24-hour, 7-day, and 30-day aggregate reads on production data.
- Monthly shared-pool capacity uses the user-approved maximum known positive limit per `(account, provider, poolKey)`; no actual mixed-limit conflicts are observed in shipped production data. Identical positive daily caps now retain one known daily axis in either catalog order; different positive caps still fail refresh and preserve the previous snapshot. Independent review and tests closed this regression. Before production enforcement, verify how shared daily metadata represents per-model limits versus pool shape and measure refresh/read costs on production data.
- Reserve demand, capacity, calculation, config, refresh, diagnostics, and account narrowing are implemented and reviewed. Reserve source tests pass 25/25 across three suites; account-routing E2E passes 4/4. The user-approved disabled state is a full stop: no source reads, calculations, refreshes, diagnostics, or account narrowing. Do not add disabled-state shadow work.
- Reserve isolation task 2.6 is complete: independent review closed without findings; focused isolation tests pass 2/2, and isolation/reserve/E2E/demand/capacity suites pass 5 files / 31 tests with two workers. The test exercises default adapters, successful enabled refresh, real catalog lookup, guarded Radar sync/scheduler access, and same-DB `.prepare`/`exec` write traps. Its feed cache is empty, so it covers the real cache read plus static-baseline fallback, not the overlay/local-merge branch. Optional follow-up, not a release gate: add a focused non-empty-cache overlay case if reserve later consumes or changes that branch.
- Before production enforcement, compare enabled reserve exclusions against observed quota exhaustion using an approved read-only validation; measure refresh behavior and confirm no database writes. Keep the disabled state as a full stop throughout. Review the approved 7-day lookback against weekly Hermes schedules during that validation; change it only with separate approval.
- Consider a separate proposal for a self-hosted Radar limits feed (`RADAR_FEED_URL`, `RADAR_FEED_PUBKEY`) if OmniRoute needs its own measured capacity data.

## Decisions and remaining work for `add-systemone-decisions-route`

- The user approved and froze this separate package on 2026-10-03: 23 tasks, 9
  requirements, 27 scenarios; OpenSpec validation passed. Implementation and
  local review are complete: 46/46 schema, dispatch, and route tests pass;
  OpenAPI coverage passes 8/8; the route checker reports 276 baseline entries
  and 0 new findings. Three independently confirmed defects were fixed: tiny
  BYOB reads no longer retain near-1 MiB buffers; late success cannot clear a
  newer cooldown; upstream error text is not persisted in call-log summaries.
  Core/OpenSSE typechecks, lint, Prettier, and diff checks pass. Live and
  production checks remain open, so do not archive the package.
- Keep these follow-ups visible: verify the live OpenRouter response shape;
  validate Laya-only behavior for RU/UK and fallback after Laya stops; exercise
  413/422 recovery with a following small request; collect a representative
  latency sample; verify `allowedModels` policy, production flag-off,
  deployment variables and rollback, and error-row monitoring. Laya deployment
  and the Hermes caller switch are outside OmniRoute's repository scope.

Deferred cross-repository and operations work:

- Before release, run `npm run check:openapi-breaking` with `oasdiff` available.
  The local check was skipped because the binary is absent; this gate is
  advisory and did not validate breaking changes.
- Resolve repository-wide Markdown lint debt in a separate docs-maintenance
  slice. `npm run lint:md` reports 1,738 findings across 164 of 182 files;
  targeted baseline comparison found no increase in the changed reference and
  operations docs, and the changed OpenSpec/TODO files are clean.
- Keep `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md` aligned with verified operational evidence. It documents keyless public Radar activation, the post-deploy dashboard Intel-key step, manual calibration, reserve enablement/rollback, and reviewed test results. Production deployment and migration are complete. Authenticated route smoke, Radar public sync/cache verification, real-catalog calibration, live band routing/log identity, and reserve read-only checks remain open; Radar's correct route/port mapping is confirmed by auth responses.
- After the remaining implementation and operational gates pass, reconcile stale approval-only wording in `openspec/README.md`, merge the three auto-quality-band deltas (26 distinct requirements) and the SystemOne delta (9 requirements) into the living specs, validate strictly, then archive the four remaining active packages: the three auto-quality-band changes and the SystemOne change. The production webpack-memory and official-image-overlay packages are already archived; keep the remaining packages open until their gates pass.
- After band behavior and role mapping are validated, migrate Hermes `fmo-grid-*` profiles to the selected `auto/<task>_<band>[_<cap>...][:<tier>]` channels.


## Laya SystemOne HTTP registration — 2026-10-04

- [ ] Finish `fix-overlay-http-route-registration`: permanent source regression,
  main transfer, accepted-image publication/deployment, then verify actual
  HTTP dispatch after container recreation. Authorized server hotfix currently
  works but recreation discards patched manifests. Push was authorized and source0e12d43fde published. First CI37192253790
  was cancelled before publication after runtime-helper probing; corrected
  source uses the shipped Next sorter and passes8/8 plus isolated-image module
  loading. Accepted-image deployment remains pending. See design for rollback.
- [ ] Preserve remaining `add-systemone-decisions-route` acceptance gates:
  TypeSafe failover/capacity, latency comparison, live OpenRouter shape,
  restricted-key policies, flag-off final-image smoke. This Laya-only cutover
  cannot close or archive that broader package.
- [ ] Browser micro-loop/Camofox-to-BrowserUse ref/coordinate integration remains
  separate Hermes work; frozen browser-profile HTTP200 proves connectivity,
  not live browser action execution or general decision accuracy.

- [ ] Existing main docs gate: `check:env-doc-sync` fails because
  `GITHUB_API_URL`, `GITHUB_REF`, `GITHUB_REPOSITORY` are referenced by CD code
  but absent from `.env.example`. Reproduced on unchanged e461ed673d main
  checkout and this fix worktree; unrelated to overlay registration changes.
  Correct GitHub runner-variable documentation/allowlist in separate CD docs
  work. Other doc-check warnings remain advisory baseline output.

- [x] Runtime sorter correction within `fix-overlay-http-route-registration`:
  the official standalone image omits build-only `sortable-routes.js`. Use the
  retained `sorted-routes.js` helper; runtime loading/precedence regression8/8
  and exact isolated-image module load pass.
  First CI run37192253790 cancelled before publication; live temporary fix
  remains healthy. Corrected source publication/deployment remains tracked in
  the main cutover item above.
