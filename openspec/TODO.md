# OpenSpec TODO

Deferred scope discovered while preparing the Hermes OmniRoute specs.

## Auto fallback incident follow-up

- [x] Use native modelLockout.enabled=true via production API PATCH200/GET200.
      Backend/UI defaults, recorder, exact-tuple cooling and filtering unchanged.
- [x] Remove all proposed production source changes: preserve native30 total
      attempts (hard200), error classification, identical-model guard, gateway
      cancellation and timeout resolver. All src/open-sse files match original BASE.
- [x] TL011 confirms original backend/UI defaults bothfalse, raw GET/normalized
      PATCH, draft-only reset and official UI preservation by overlay packaging.
- [x] TL012 verifies4 unknown-model benchmark cases, including actual local
      target timeout400000 plus fallback250000=650000 before caller1200000.
      Same saved comboTimeoutMs1200000 passes on original BASE loop; source change
      is unnecessary. Persisted native comboDefaults1200000 via PATCH200/GET200.
- [x] Final combined fork regression43/43 passed; PR54 restored all production
      source to BASE and live455442b05754 (merge23066b5c22).
- [ ] SUSPENDED / owner-dependent: manual price and structured-output provider
      tests remain on hold pending the owner's answer about the current probe ban.
      These tests and any fresh inference are not package-closure gates. Preserve
      native strict-free policy; do not probe providers or models in this slice.
- [ ] SUSPENDED / owner-dependent normalization follow-up: resolve live high-SO
      executable-pool gate only before any separately authorized fresh normalization
      acceptance: smoke3432f08c-8b2c-4e20-b704-7c689ede3a97 returned404 before
      provider dispatch despite9 diagnostic rows for each manage key. Historical
      high-SO diagnostic reasons:6 not-in-catalog,3 state-unknown; zero of those
      nine strict-policy-admitted. `reachable=true` plus `excluded=false` is not
      an executable count. Current diagnostic and strict-admitted/orderable counts
      remain unproven. Never widen strict eligibility to clear this gate.
      Initial PR53 main changes were reverted. Its GitHub image build41209904236 was cancelled before publish/deploy;
      image workflow disabled, live source455442b05754. No local image builds.
- [x] Historical app-only activation: persistent gateway-only zero envs were set
      using current image and --no-build. Image603b8d65b894 and source455442b05754 unchanged; healthcheck passes,
      Redis preserved. Benchmark processor bypasses gateway. This prior runtime
      had saved model lockout enabled, combo timeout 1,200,000 ms, and gateway
      settings at zero. It does not prove settings in the candidate image after
      the failed protected deployment; 20 minutes is not a models.dev interval.
- [ ] SUSPENDED / owner-dependent: fresh production benchmark normalization is
      separate from TL015 source closure and is not a required benchmark/package
      closure gate. Historical queue runs were Oct 26/27 with 9 normalization
      timeout rows; no new inference, queue reset, or normalization is authorized.
- [ ] Separate upstream SDK issue: REQUEST_TIMEOUT_MS=0 converts to one-second
      Stainless timeout. Keep generic override unset; no SDK source change here.
- [ ] Preserve known baseline debt:720 TypeScript diagnostics/113 files,72 docs
      strict drifts and unrelated invalid packages. Do not repair upstream tests.
      Historical302249ms failure fits effective310000ms default; pool and stop
      cause remain unknown. No scoring or paid fallback changes.

## ARM64 source-compilation regression

- [x] Remove the duplicate TypeScript imports reported by workflow run
      `40871049172` in `resolveAutoStrategy.ts` and `opencodeHeaders.ts`; focused
      compiler regression and source/import-graph syntax checks pass. See change
      `fix-arm64-build-duplicate-declarations` and `completion.review`.
- [ ] After the reviewed source fix is integrated, run the normal ARM64 workflow
      and retain its compiler/publish receipts before considering deploy. This
      is the remaining compile acceptance: an earlier isolated local
      `npm run build:contributor` reached Next.js webpack but exited with
      SIGTERM after about 15 minutes before a result, so it is inconclusive.
      Current host rules forbid repeating local app/image builds; the normal
      GitHub workflow remains the acceptance path. No image was published or
      deployed by the local source correction.

## Strict zero-cost models.dev evidence

- [x] The strict filter currently relied on `FREE_MODEL_BUDGETS` and rejected
      live candidates outside that table, even when the raw models.dev catalog
      has an explicit zero input and zero output price. The normalized pricing
      cache is not safe as proof because it defaults a missing output price to
      zero and remaps some source providers. Implement and review the focused
      `add-modeldev-zero-price-strict-gate` package using exact raw identities,
      durable freshness, and fail-closed matching. Do not weaken existing
      static quota/hard-stop rules or route outside `:free`.
- [ ] After deployment, verify the exact in-band free/tools pool and one
      controlled forced tool call with separate client/provider counts,
      actual model/connection, zero-cost evidence, and no paid/out-of-band
      fallback. If no eligible fresh model remains or a provider rate-limits,
      stop inference and record the blocked acceptance without retrying paid.

## Full-catalog benchmark scoring

- [x] Full-catalog scoring merged through PR #28 at main merge
      `81289e18e3efa8273f044621224481080e6d2598`: one-time backfill for each
      unique current models.dev ID, enqueue later exact IDs, resumable queue
      batches, and evidence-supported scores in `benchmark_fitness`. Models
      without enough comparable verified measurements remain unrated. See the
      OpenSpec package and `completion.review`.
- [x] Live DB review found OpenRouter stores `auth_type='apikey'`; the merged
      processor searched for `api_key`, blocking strict-SO normalization before
      model selection. A regression reproduced the mismatch; the follow-up
      changes the filter to `apikey` and proves exact free connection selection
      without inference. Node 68/68, routing Vitest 21/21, scoped ESLint and
      Prettier pass. Independent review found no blocker; release remains
      pending.
- [x] PR #29 merged at main source
      `d2244e12145b554922899cd2b00f84f9d724ff9e` and deployed with image
      `sha256:5e33c45ecf616c2b5e3a6374bca1b0a9abd43cfcdda0801474c017ed96cd3709`.
      Models.dev sync ran and reached 10,398 capability rows. This did not run
      the new benchmark queue: deployed DB journal remains at 196 and the new
      search tables are absent.
- [x] Image packaging for migrations 197–198 and the candidate-image migration
      manifest gate are deployed. Live image `sha256:7acec5fe8e3b60bd4d71e1ab75c1343ebd2afb0004a64212ac57cc9558637024`
      reports source revision `c8841217893abbc152f11c9a102fa805b0b9bf46` and
      healthy status. The live database has benchmark-search evidence and queue
      tables, confirming the migrations ran.
- [ ] Resume and verify the full-catalog queue. At the latest live receipt,
      4,095 models were queued: 975 pending, 3,115 `source_error`, and 5
      scored. There are 162 evidence rows and 10 global `benchmark_fitness`
      rows; 4,090 queue rows remain `normalization_status=not_started`. All
      3,115 source errors are the exact missing `AA_API_KEY` failure. Live
      image remains healthy at revision `c8841217893abbc152f11c9a102fa805b0b9bf46`
      and the running container has no `AA_API_KEY`. Local recovery retries
      only these key-blocked rows once a key is configured; this fix is not yet
      deployed. Do not turn a failed AA request into an exact miss or start
      search before all direct-source scans complete.
- [x] Implement the owner-directed effort profiles locally. Keep
      global `benchmark_fitness` for generic Auto scoring; band profiles are
      low→low, medium→medium, high→xhigh (per model when present), then high.
      If the target effort is absent, use unknown-effort evidence, then a
      same-model other-effort proxy marked low confidence. Never zero or gate
      on reasoning capability. Persist profile rows separately, resolve the
      matching profile ahead of global benchmark rows, preserve manual/Arena
      priority, and remove stale profile rows. AA-anchor calibration remains
      experimental pending per-profile holdout evidence. Focused tests passed
      and independent review found no concrete defect. The source change is
      local only, not committed, deployed, or live-verified.
- [ ] Reassess the low/mid/high cutoffs after full-catalog profile scores exist.
      In the saved 78-row offline snapshot, raw high-profile coding counts were
      12 at `>=.70`, 13 at `>=.65`, and 17 at `>=.60`; AA calibration changed
      the high-band count to 15. Those old counts do not set live thresholds.
- [ ] After profile deployment and AA-key recovery, verify full-catalog
      current-snapshot scored/unrated totals and native profile publication.
      The normal models.dev sync refreshes current benchmarks directly; manual
      discovery queue work remains separate. Paid or out-of-band fallback is
      prohibited for that optional search workflow.

## Missing-model benchmark search

- [x] Prepare queue liveness fix on `fix/model-benchmark-search-recovery`.
      Live inspection on 2026-10-26 found 20 rows all `running`, each claimed
      at 17:02:47Z with attempt 2; queue counts and timestamps had not moved,
      and there were no matching search/benchmark logs. Source proves the drain
      preclaimed 20 rows and persisted status only after the whole batch; the
      exact awaited operation remains unproven. The local fix claims and
      finishes one row at a time, persists search evidence before strict-SO,
      aborts strict-SO after five minutes, and schedules recovery for fresh
      running rows at their 15-minute stale boundary. A complete AA/official
      match now blocks HF/web discovery even when it has no usable fitness
      score. Focused regression tests pass 34/34. Independent review found and
      prompted a fix for exhausted rows being treated as eligible before
      terminal cleanup; follow-up reviews confirmed both fixes with no
      remaining findings. PR #33 merged at source
      `3529ee2e5d7d76c269d6064d0287c732f47aef65`; image
      `sha256:05a0c6c3ee78b9975c44996a12e3374d9c32fde77675c0d18b6eeb6a0c5d1860`
      is deployed and healthy.

- [ ] Owner-directed strict-SO route correction and benchmark-search live
      acceptance remain open. At the 2026-10-26 snapshot, production was healthy on source
      `32165ff7f223a31c5f83d764bd2ea9e593790be8`, image
      `ghcr.io/etcetera-agency/omniroute@sha256:267dcd1338693835f48524587c89a75c42f55ecd306e4d25cfbad40adfd699c3`.
      Read-only live database inspection on 2026-10-26 showed 4,095 queue rows:
      346 `review_required`, 99 `scored`, 3,600 `source_error`, and 50
      `unrated_no_evidence`; latest run is `2026-10-26T22:06:51.785Z`. The
      periodic models.dev sync is enabled and its startup log reports 10,004
      pricing entries and 10,411 capability rows, but the benchmark queue has
      not advanced since its latest run. The deployed normalizer still uses
      `handleOneShotBenchmarkChat` with one exact model/connection; its live
      Structured Output request returned HTTP 429.
      Owner directed that the normalizer use OmniRoute's established Auto
      failover instead of bypassing it. Read-only candidate GETs returned 10
      targets for `general_high_so:free`, 5 for `general_mid_so:free`, and 17
      for `general_low_so:free`. Change
      `route-benchmark-normalization-auto-failover` replaces the pinned request
      with `auto/general_high_so:free`; dispatch is blocked unless bands are
      enabled and `freeAccessPolicy` is `strict`. No live model request, provider
      setting change, or queue reset was made during this source correction.
      Offline regressions prove the exact high/SO/free channel advances from a
      mocked 429 to a second candidate in the same free band, never to the saved
      paid combo or global fallback. They also prove a zero-candidate explicit
      free band cannot widen through the legacy full-catalog expansion, even
      when that fallback flag is enabled. Production 429/cooldown behavior has
      not been exercised by a new request. After deployment, let the normal
      queue and route honor any active cooldown; then capture a naturally
      dispatched strict-SO result, actual model/request receipt, zero-cost route
      proof, and scheduled queue progress with scored/unrated totals. Do not pin
      a provider, manufacture a live 429, reset the queue, or send duplicate
      requests while the normal route is cooling down.
      On 2026-10-27, a standard models.dev sync completed and advanced the
      queue one row at a time. Ollama Search returned zero-cost candidates for
      `openai-gpt-56-luna-pro` and `openai-gpt-56-sol`; both normalizer requests
      used `auto/general_high_so:free` but hit the scorer's five-minute timeout.
      The service logged the ordinary `integrate.api.nvidia.com` response-start
      retry; no provider pin or pool change was made. A code-graph review found
      that Auto has its own ten-minute safety cap and can return HTTP 504 before
      the scorer deadline. The local fix leaves that cap unchanged, gives the
      scorer twenty minutes, keeps the stale-row lease at twenty-five minutes,
      and defers either a route HTTP 504 or true scorer timeout with the existing
      fifteen-minute queue retry. The 504 regression first reproduced the queue
      advancing after Auto's own safety response; final focused tests pass 3/3,
      including the native-504 deferral. Prettier passes and the repo-wide core
      typecheck has no diagnostics in changed files. Independent Luna review
      confirmed retry eligibility after the stored delay and found no remaining
      issue. PR #37 subsequently merged at
      `281318c410320c2e1a3e604b1eec4e5d510eff7c` and deployed as image
      `ghcr.io/etcetera-agency/omniroute@sha256:4ced97b3fc1920b1e70e4b85d9ae39b4707e733e39d4972a8393478b425bd166`.
      Read-only inspection at 06:12 UTC found the ordinary normalizer request
      had ended in Auto's HTTP 504 after four of ten targets, with an existing
      retry due at 06:27:02 UTC. The queue began its due source search at
      06:27:04 UTC; no normalizer response had appeared by the 06:27:05 UTC
      snapshot. No request was manually triggered and no route, provider,
      candidate-pool, cooldown, or queue state was changed. A local follow-up
      on `fix/benchmark-normalizer-verbatim-evidence-20261027` now tells the
      normalizer to quote exact title/snippet text and rejects paraphrases or
      quotes spanning title and snippet. Targeted regressions pass 2/2, the full
      `modelBenchmarkSearch.test.ts` passes 41/41, Prettier passes, and
      independent Luna-high review found no remaining issue. This follow-up is
      committed as `78b751a266ed039c1f1cca4361a3c336ad874ac6` and pushed in
      PR #38; it is not merged or deployed. On its due 06:27 UTC retry the
      ordinary route selected `nvidia/z-ai/glm-5.3-flash`, which timed out, then
      advanced to `openrouter/dots-studio/dots-3-note-preview:free`. That target
      returned HTTP 200 with `finish_reason=length` and no content; Auto tried
      further in-band targets, then ended at its normal 600-second timeout
      (`06:37:05 UTC`) before a terminal response. No HTTP 429 occurred. The
      queue persisted `retry_after_at=2026-10-27T06:52:05.799Z`. No normalizer
      output was accepted. Queue attempts=3 is queue-claim count, not provider
      attempt count. Strict-SO output receipt and fresh queue progress remain
      open. Do not manually trigger or redirect the due retry.
      A 05:10 UTC pre-deployment read-only snapshot found a healthy container
      on source `dc240241f56b6919024d8be0ccec25fe46f78b9d`, with 199 applied
      migrations and queue counts 353 review-required, 1 running, 99 scored,
      3,592 source-error, 50 unrated-no-evidence. `openai-gpt-6-astra-pro` was
      already running from 05:08:30 UTC; do not duplicate it during cutover.
      The three earlier normalizer failures have no retry timestamp and were
      not reset/requeued; review their reprocessing as a separate queue action.
      Reasoning-routing overrides were found to be another pre-dispatch route
      rewrite; a local guard now fails closed for an explicit free Auto channel,
      with a regression proving no paid provider call is made. Exact live
      cooldown and normalizer acceptance remain open. The candidate-pool guard
      now imports `parseBandId` from the pure band grammar module, avoiding a
      new static dependency on Radar database resolution. The dedicated normal
      Auto routing test passes 2/2, normalizer route/policy checks pass 3/3, and
      the complete `modelBenchmarkSearch.test.ts` file passes 41/41 after its
      test-only route wait was raised to 30 seconds; production spacing and
      cooldown are unchanged. The remaining free-verdict static Radar-boundary
      failure also reproduces on clean `origin/main` through the pre-existing
      `autoRouting.ts` → `suffixComposition.ts` → `bands/index.ts` path; track
      that baseline cleanup separately. The mocked 429 case verifies the
      existing in-band Auto failover; production cooldown behavior has not been
      exercised and must be allowed to proceed naturally after deployment.
      A separate legacy edge remains outside this new-band change: a reasoning
      rule can rewrite `auto/best-free` before its free-tier filter. Decide in a
      separate task whether that historical requester needs the same fail-closed
      guarantee; it was not changed here.
      Project type checks remain red: `typecheck:core` has broad diagnostics, and
      `check:open-sse-typecheck` reports `open-sse/services/systemOne/schema.ts`
      TS2353 plus `src/lib/proxySubscription/parse.ts` TS2345 (three instances).
      These files are outside this diff; verify and resolve them separately.

- [x] Local `add-model-benchmark-search` source-lookup slice: successful
      non-dry-run models.dev capability syncs detect exact new model IDs after
      the initial baseline, persist an idempotent queue row before replacing
      the previous capability snapshot, and drain one row in the background.
      AA Free plus SWE-bench, Terminal-Bench 2.0/2.1, and DeepSWE must all be
      complete exact misses before Hugging Face eval metadata and explicit
      `ollama-search` discovery run. Raw source/version/model/benchmark/
      effort/config/value/URL/date/status evidence stays in separate tables;
      source failures, partial scans, and missing effort/value stay unverified
      and unrated. No frozen score-map write path exists. Focused RED/GREEN
      tests and core typecheck are recorded in `completion.review`.
- [ ] `add-model-benchmark-search` 2026-10-27 correction remains open: the
      internal direct-only reprocessor and bundled operator entry are locally
      implemented; after review and commit, obtain owner-approved
      integration/release and complete live acceptance.
      Fingerprint includes benchmark and metric; the first complete current
      refresh replaces legacy direct rows from the live five-feed snapshot.
      Migration 200 drops legacy raw payloads rather than replaying an archive. The
      earlier active-only live runbook is superseded by the full-canonical
      current-snapshot task below; do not run it as the fitness refresh. TL304 found 31
      actual strict-zero-cost built-in-band candidates with no
      `benchmark_fitness*` rows: 29 have `user_override` rows and two lack exact
      models.dev identity matches. TL304 provenance trace found 152
      assistant-generated synthetic overrides across 76 models, all written at
      `2026-10-25 17:32:06`, each matching the exact tier-default pair; no later
      override timestamp exists. After direct evidence is ready, back up and
      remove only that exact key/value/timestamp whitelist with a
      concurrent-change guard, then verify unchanged code-level override
      precedence and recalculated fitness. The prepared whitelist is
      `/tmp/tl304-user-override-whitelist-20261027.json` with SHA-256
      `15f674bc4b8baacb3033a25c5220a842c050e060d2f11193aad297e704cb11d1`;
      it contains 152 rows across 76 exact coding/default pairs (58 `.92/.85`,
      5 `.85/.78`, 13 `.65/.55`). Verify its hash and all row preconditions
      before the later authorized cleanup; no cleanup or DB backup has run.
      Verify direct evidence reaches every available candidate ID and receipt
      unmatched IDs.
      Identity-only runtime model records may be inserted to satisfy evidence
      storage foreign keys, but new rows must be nonclaimable
      `unrated_no_evidence` before materialization; after recompute, only new
      rows settle to nonclaimable scored/review-required/unrated outcomes, and
      conflicts preserve status. Do not create search
      run/job rows or use provider-prefix stripping as source matching. TL304's
      read-only map found full-ID equality to models.dev for 1/31 candidates;
      removing exactly the first provider segment yields catalog identities for
      31/31. Keep that mapping as receipt context only; store and score the
      actual runtime IDs. `groq/allam-2-7b` has both exact and stripped catalog
      rows, so do not silently rewrite it. The two candidates without existing
      intelligence/override rows are `nvidia/minimaxai/minimax-m3.1-flash` and
      `openrouter/recursive/flint-v1.0:free`; both have canonical catalog rows.
      Gate startup auto-sync off before deployment/reprocessing.
- [x] Add a separate strict-SO processor for candidates from explicit free
      web search candidates. The original implementation used a pinned
      `xingchen-agi/xing4.0-29b-a4b:free` / Phala connection and is superseded
      by `route-benchmark-normalization-auto-failover` above. The current path
      uses ordinary `handleChat` with `auto/general_high_so:free`; output fields
      still require an exact returned URL and quote from its title/snippet.
      Records remain review-required and unrated; score-map is untouched.
- [x] Read-only live gates and zero-cost Ollama search are verified. A
      controlled search returned and persisted candidates. A previous pinned
      strict-SO request returned HTTP 429; its successful output validation is
      still open and the pin has since been removed. Complete live acceptance
      only through the ordinary Auto route after any real cooldown expires; keep
      failed requests and invalid evidence unrated.
- [ ] Keep production ratings blocked until a reviewer confirms exact model
      identity, reasoning effort/config, benchmark/version, metric/value, source
      URL/date, and source verification status. Independently calibrate/review
      any score-map update before production publication.
- [ ] Re-establish a green full-suite baseline before claiming full verification.
      `npm run test:vitest` passed 619/620; the unchanged
      `tests/unit/autoCombo/bands-config.test.ts` mtime-retry case fails both in
      the full run and alone (12/13 pass). `npm run test:unit` was interrupted
      after over 35 minutes and reported a failure in the unchanged
      `tests/unit/workflows-no-foreign-fork-publishers.test.ts`. The 2026-10-27
      first full `tests/unit/modelBenchmarkSearch.test.ts` run passed 40/41. The
      2-second test wait was too short for the normal Auto route after earlier
      file tests; the current branch passes 41/41 with a 30-second test-only
      wait and timeout. Do not lower or bypass the production 5-second
      normalizer spacing. Re-establish a green full-suite baseline in a suitable
      runtime; the unrelated Vitest/unit-suite failures remain.

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
- Live band audit (2026-10-25; deployed source `876c6c4b471c5a1eb344418a249217f5b309d706`; image `ghcr.io/etcetera-agency/omniroute@sha256:685cc7e04ad6d3d30a097569eb0b2504f154501d66b66d05e440e7b502572ac6`): `auto/coding_high_tools:free` and `auto/coding_mid_tools:free` return zero candidates; `auto/coding_high:free` is also empty, so tools are not the root cause. `auto/coding_low_tools:free` returns 64 reachable account rows (41 provider/model pairs), showing free+tools candidates exist. Live coding intelligence contains no `user_override`/`arena_elo` score for those candidates; `models_dev_tier` exists via `model_capabilities` but is absent from default `ratedSources`.
- Root cause: default band filter rejects capability-derived `models_dev_tier` scores as unrated before comparing them with the 0.70 high minimum; threshold was not the reason for the empty pool. The owner approved those scores specifically for `coding/high/free`. Local branch `codex/auto-band-live-fix` now admits `models_dev_tier` and inherited variants only in that band; global defaults, calibration, other tasks/ranges, `:free`, and mandatory tools remain unchanged. Focused selection passes 23 tests; 12 unrelated cases are skipped by the name filter. Main still serves source `876c6c4b471c5a1eb344418a249217f5b309d706`; after the normal main release, verify the in-band free+tools candidates and run `check_combo(value=7)` with selected model/connection, zero-cost, and no paid/out-of-band-fallback receipts. No inference has been sent.
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
- The current self-hosted Kev profile selected with `model: laya/kev` is
  sequential: concurrent HTTP calls are accepted by OmniRoute but queue at
  Kev's per-profile IPC lock. Set caller concurrency to one for `laya/kev`.
  Two ~1k-chunk calls returned the same
  successful outputs sequentially (13.466s total) and concurrently at HTTP
  level (12.449s total); the second concurrent call took 12.447s. This does not
  establish behavior for other profiles or upstreams. A worker pool remains
  future work only if concurrent Kev inference is needed.
- Node 24 documentation validation passes sync, frontmatter, strict counts,
  links, and fabricated-doc checks. Full `check:docs-all` remains stopped by
  existing `.env.example` drift (`GITHUB_API_URL`, `GITHUB_REF`,
  `GITHUB_REPOSITORY`). Markdownlint baseline comparison is unchanged at 706
  existing findings; deprecated-version scan reports 97 existing candidates.

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

- [x] `fix-overlay-http-route-registration` deployed and HTTP accepted:
      source2a6c97ef0942db1c716da5b3893ae9fcd224b022, CI37193326716;
      image sha256:2af8dc00414eff32c80aa8f84b52eb26a17f8878cfd93bb5a29e8fe37e75f7af.
      Fresh container and immutable-image map verified. All three selectors200,
      RU/UK200; private keyless401/public403; Redis healthy, body-free call logs.
      Fix requirements merged and package archived2026-10-04. Broader gates below
      remain separate.
- [ ] Preserve remaining `add-systemone-decisions-route` acceptance gates:
      TypeSafe failover/capacity, latency comparison, live OpenRouter shape,
      restricted-key policies, flag-off final-image smoke. This Laya-only cutover
      cannot close or archive that broader package.
- [x] `fix-systemone-browser-instruction-objects` deployed and accepted:
      PR20, CI38092417701, source3118278b8cfcbbdd774c42ce2ef8be9036346544;
      image sha256:afbe9594c6d1bbc5448153acc6192dfcfcacef2216589a1dbcec955b2857480f.
      All five explicit profiles200 with matching routing identity; Browser v19s
      structured instructions reach Laya intact. Private keyless401/public403,
      app healthy, Redis identity preserved, journal SUCCEEDED/complete.
      Scoped request-validation living spec created; correction archived2026-10-11.
      Broader SystemOne package and navigation-quality work remain separate.
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
      First CI run37192253790 cancelled before publication; corrected source deployment and durable HTTP acceptance passed as recorded
      in the cutover item above.

## Minimal Laya budgets and overlay provenance release gates — 2026-10-18

- [ ] After integration on approved current source, run the native/production Laya acceptance: verify valid pinned budgets arrive unchanged, invalid/unpaired/over-ceiling values stop before auth/dispatch, chain and non-Laya pins omit budgets, and the configured Laya ceiling matches service limit. Keep `add-systemone-laya-token-budgets` open until accepted.
- [ ] Build the official ARM64 overlay in authorized CI from the exact full source SHA. Verify compiled SystemOne route, selected server `BUILD_SHA` exact framing/value, OCI revision label, and immutable image digest all identify that SHA. No local image build/pull was done. Keep `add-overlay-build-provenance` open until image evidence passes.
- [ ] Against that verified image, complete approved SDK integration and authenticated SystemOne runtime acceptance; record image/source identities and results before archiving either package.
- [ ] Run strict OpenSpec validation and the owner-approved final verification matrix on the integrated source. The scoped worktree has no OpenSpec CLI; its focused suites pass, but this does not close integration gates.

- [ ] After release acceptance, reconcile pre-existing delta archive applicability notices separately; strict schema validation is not archive readiness. Seven existing atomic-format reconciliations imported as a docs-only prerequisite, not permission to reopen unrelated runtime/E2E work.

- [ ] A2 source is locally verified (56focused, strict11/11, ESLint, independent review/Simplifier); obtain exact CI image tuple and run authorized A5/A6 before claiming live Laya budget delivery or semantic discrimination.

- [ ] A4 source ready after26focused/strict11/11/independent review/Simplifier; obtain owner-authorized push/main integration for existing GitHub image workflow. Verify actual fullSHA/BUILD_SHA/compiledrouteSHA/image digest, then follow A5backup/deploy/smokes and A6matrix. Existing unrelated test repairs remain outside minimal release.

# Free auto-band score-source correction — 2026-10-25

- [x] Implement and review `fix-free-band-quality-sources` locally: treat
      `models_dev_tier` as rated in all explicit free task/band predicates
      and refresh AutoCombo's cached capabilities after successful models.dev
      synchronization. Keep task fitness global by raw model ID; do not add a
      provider-specific lookup or copy capability estimates into `user_override`.
      Focused band-filter tests pass 14/14; the broader changed AutoCombo tests
      pass 19/19; the sync/cache regression and core typecheck passed in an
      isolated Linux-compatible environment. The quality-source follow-up now
      also passes 26 AA configuration tests, 24 estimator tests, 26 AutoCombo
      Vitest tests, and strict OpenSpec validation via isolated `npm exec`.
- [x] Owner decision 2026-10-25: use the global `models_dev_tier` capability
      estimate as a marked fallback for `low`, `mid`, and `high` on explicit
      free requests. Keep it separate from benchmark fitness; it is not a
      benchmark result. Implemented in the local `fix-free-band-quality-sources`
      change, not yet merged or deployed.
- [x] Evaluate task-specific evidence and exact model/config mapping. The AA
      API has separate configuration rows and scores; `name` can show an effort
      suffix (official example: `gpt-oss-20B (high)`), while the schema has no
      normalized `reasoning_effort` field. Pro's `reasoning_model` is boolean,
      not an effort level. Candidate mapping selects the actual AA effort row;
      a missing mapped high/xhigh row uses a marked sibling estimate, never a
      zero. Exact source mappings and calculation are recorded in
      `openspec/changes/fix-free-band-quality-sources/`. Unreviewed fuzzy name
      merging was removed; only exact reviewed aliases are applied. Local only;
      integration/deployment remain pending.
- [ ] Design and implement a reviewed refresh flow for newly added models and
      AA reasoning configurations. Use the closed benchmark list and verified
      structured-output contract; keep automatic writes separate from the
      current frozen snapshot until that flow is independently reviewed.
- [ ] Reassess individual band assignments after collecting broader independent
      benchmark evidence. Current leave-one-family-out checks change membership
      for 7–12 model IDs, and these relative scores are not task-success
      probabilities. Keep the current thresholds unchanged until then.
- [ ] Audit the exactly identified assistant-generated synthetic
      `user_override` rows stored as provider/model IDs. Back up and remove only
      those generated rows after verifying the exact source/model/category
      keys and confirming no operator-owned overrides were introduced.
- [x] Independent app-server thread `01a17450-0959-74c2-88b7-47dc50e226bf`
      completed a static assessment: the capability-derived fitness heuristic
      over-admits coding-high; the absolute quality error per model is unknown.
      Do not treat capabilities as benchmark results or calibrate from this
      heuristic alone.
- [ ] Before live acceptance, confirm exact free-tier, in-band, capability-
      matching candidate rows and complete the controlled forced-tool-call
      smoke with separate client request/provider-attempt counts, actual
      model/connection, tool result, route, and zero-cost/no-fallback receipts.
- [ ] Do not deploy or run model inference until the live strict zero-cost
      route is verified against the changed source. No paid or out-of-band
      fallback is permitted.

# Benchmark evidence integrity and direct reprocessing — 2026-10-27

- [x] Fix the live PR #39 direct-operator packaging failure in local source.
      One explicit run of `/app/scripts/ops/reprocess-model-benchmark-search.mjs`
      failed before DB work with `ERR_MODULE_NOT_FOUND` for
      `@aws-sdk/client-bedrock-runtime`; deployed image digest is
      `sha256:c51c4d12acaaf038eb7634eef62d50ce1b660f3c5b828be35e167550eb7cacd9`.
      The transitive path was operator → `modelBenchmarkSearch.ts` → static
      `modelBenchmarkSearchProcessor.ts` → `handleChat`/executor registry →
      Bedrock runtime SDK. The local fix moves pure normalization constants and
      retry parsing to `modelBenchmarkSearchNormalization.ts`, then dynamically
      loads the processor only from queued search normalization. The operator
      eager bundle graph excludes the missing SDK while the queued path remains
      available. RED on the prior artifact reproduced the unresolved SDK in the
      runtime dependency tree. GREEN: the new artifact resolved 130 emitted
      files and 31 external imports, and the actual bundle's `--check-runtime`
      import completed in an isolated Node 24 runtime tree with the Bedrock SDK
      absent. The smoke used only a temporary `/tmp` data directory and made no
      network, provider, search, queue, or production database calls. Existing
      suites pass 44/44 and 5/5. Independent review found an unused test
      binding, which was removed; follow-up review found no remaining issue.
      Code Simplifier found no simpler change that preserved the queue path.
      Dockerfile now runs both checks in the final runtime stage with network
      disabled. A narrow `.dockerignore` whitelist includes only the resolver
      smoke; a root-context BuildKit `FROM scratch`/`COPY tests` check exported
      only that file and passed byte comparison. The ARM64 image build was not
      run locally: this host is AMD64
      and lacks the required `backend_export` build input. After integration,
      build the authoritative ARM64 final image and retain its smoke receipt.
      Release still requires the existing maintenance gate: prevent startup
      models.dev sync/queue drain, run the explicit current-snapshot operator
      once across all canonical IDs, and inspect receipts.
- [x] Diagnose main image run `40504168756`: the resolver test copy passed,
      but Node 26 resolved `undici` from the test's `/tmp` location instead of
      `/app/node_modules`. Move the temporary test under
      `/app/scripts/ops`; keep unresolved dependencies fatal. On the pinned
      ARM64 runtime image, Node `v26.10.0` resolved `/app/node_modules/undici`,
      the `/tmp` test reproduced the path error, the `/app` resolver passed
      130 emitted files/31 external imports, and the actual bundle
      `--check-runtime` passed. Both container runs used `--network=none`, a
      read-only root, read-only smoke artifacts, and tmpfs `/tmp`; no production
      data, env, keys, provider calls, or container changes were involved. Run
      `40504168756` failed before publish/deploy.
- [x] Merge latest `origin/main` into `feat/upstream-v3852-final-20261027`
      with a normal two-parent merge. Parents are feature
      `8439e210fca55b42707273be52a26982e67e1839` and main
      `7bb10048702966cccaa0eebe62bb83bfad040265`; merge base is
      `fc5e2bccd4f70fecf5aab94dfb8136c74ab5a21b`. Kept PR #42 ancestry and
      semantic benchmark snapshot fix `ed6dbc5d16`; retained final official
      v3.8.52 source, full-catalog benchmark formula/native reader, direct
      refresh with zero search or inference, strict free-only Auto bands,
      models.dev capabilities, immutable fork migrations 197–199, upstream
      197–212 mapped to 200–215, fork migration 200 mapped to 216, and both
      overlay pins at OCI index
      `sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c`.
      Dropped incoming `200_model_benchmark_evidence_current_set.sql` because
      its SHA-256 exactly matches retained local migration 216; kept official
      `200_proxy_subscription_core_config.sql`, with no duplicate version and
      no migration 217. Removed duplicate Ollama limiter declarations
      introduced while combining `searchProxy.ts` and a repeated thrifty-rung
      block from `virtualFactory.ts`. Consolidated the duplicate rerank
      dispatch helper while retaining the latest database-settings API and the
      feature's caller connection scope and combo-target gate.
      Conflict choices also retain main's latest provider/session security,
      local-only route guard, rerank database settings, generated translations,
      docs, and its CI/quality/nightly workflow definitions. No workflow was
      dispatched or build run. Release-specific source, tests, and overlay
      policy remain from the reviewed feature branch. Package JSON and lockfile
      retain nonconflicting entries from both sides. Focused conflict-area
      checks, core regressions, strict OpenSpec validation, and Code Simplifier
      results are recorded in the release package `completion.review`.
- [x] Production release gate completed. Deployed source is
      `df19cd81e3031621148e13b8b4ee4b0bea52126e`, with migration journal at
      216; upstream 197–212 map to 200–215 and fork current-set migration is 216. GitHub run `40879166447` published and deployed ARM64 image
      `sha256:3239130242ccc9d6a15fb535b01bcce361379c42927c2c132a070dc83af68a35`
      against official OCI index
      `sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c`
      (ARM64 child
      `sha256:fb7f91836fd95f382a5a04af740d859e2e9731804b5c0ba43f5d2e7f9ad64794`).
      Isolated clone rehearsal passed integrity and foreign-key checks, kept
      327 benchmark observations and score projections, and rolled back its
      synthetic FTS check to a savepoint. Production evidence table has no
      `raw_json`; legacy table is absent. Failed run `40871049172` stopped
      before publish/deploy. Workflow `373883666` remains manually disabled;
      future image builds stay GitHub-only.
- [x] Verify the direct operator's raw active-catalog fitness key reaches both
      actual free `coding_high_tools` and `general_high_tools` band filters;
      keep `${providerId}/${modelId}` separate as the route-facing model string.
- [x] Finish local integrated review, regression proof, Code Simplifier, strict
      OpenSpec validation, and local commit for `add-model-benchmark-search`.
      The first complete current-source refresh replaces legacy direct rows
      without replaying archived payloads. Merge and release remain separate.
- [x] After deployment, ordinary models.dev sync completed with 9,812 pricing
      rows, 236 provider rows, and 10,216 capability rows. Current direct
      receipt: AA 416 rows / 208 raw IDs / 199 canonical IDs; DeepSWE 73 rows /
      31 raw IDs / 28 canonical IDs; SWE-bench 38 rows / 7 canonical IDs;
      Terminal-Bench 2.0 24 rows / 10 canonical IDs; Terminal-Bench 2.1 2 rows /
      1 canonical ID. Existing HF evidence remains 1,419 rows / 123 IDs from
      the 2026-10-26 capture; no new HF fetch is claimed. Native sources
      `benchmark_fitness`, `benchmark_fitness:low`,
      `benchmark_fitness:medium`, and `benchmark_fitness:high` were republished
      at 2026-10-29 13:49:27 UTC.
- [x] Validate `add-model-benchmark-search` with strict OpenSpec CLI validation
      after the integrated spec and completion record are current.
- [x] Confirm native reader and free-band lookups use raw canonical IDs.
      `claude-3.5-sonnet` resolves base `0.5` and low/medium/high
      `benchmark_fitness` profiles `0.35714285714285715`; before provider
      isolation, free-band candidates were coding low/mid/high `10/5/2` and
      general `13/3/1`. Generic Auto uses the base score; explicit bands use
      matching profiles. Existing `benchmark_consensus` and `models_dev_tier`
      remain valid fallbacks where a benchmark profile is absent; no score or
      filter change is proposed.
- [x] Finish native free-only live acceptance (TL333, 2026-10-30). Aggregate:
      five client completions and five provider attempts. Latest controlled
      request returned HTTP 200 for `free/gemini-3.8-flash` through
      `auto/coding_high_tools:free`; forced `acceptance_probe({"ready":true})`
      returned `ready=true`. Usage was 619 tokens, metadata reported explicit
      `$0/$0` per-million prices, and computed cost was `$0`; no
      `request_cost_ledger` row exists for this request. No paid or out-of-band
      attempts occurred during this successful request.
      Temporary key deletion returned 200; management GET returned 404 and SQL
      found zero key rows. Full request IDs, prior outcomes, and receipt are in
      `openspec/changes/archive/2026-10-30-generic-compatible-model-metadata/completion.review`.
      Keep provider state and protected DB/image rollback pair unchanged; do not
      restore or re-enable connections until owner steering.
- [x] TL324: integrate official APInex free-entitlement pricing through the
      source-aware reader/merge path. The official APInex model pages list 44
      models, including 21 free models with exact zero input/output prices;
      the synced custom-node model rows carry only ID, name, and source. The
      native zero-cost guard needs a fresh exact-zero pricing snapshot, while
      band tiering reads `models_dev_pricing[provider][rawModel]`. Do not infer
      entitlement from `free/` or zero-cost appearance, hand-write pricing rows,
      or change the strict zero-cost guard. This provider-specific TL324
      implementation was superseded before release by the owner-selected shared
      adapter for stored `openai-compatible` and `anthropic-compatible` node
      types; retain this package as historical evidence, not the final
      architecture. The deployed generic metadata receipt and completed native
      live gate are in
      `openspec/changes/archive/2026-10-30-generic-compatible-model-metadata/completion.review`.
      The earlier APInex `/v1/models` 401 used encrypted
      SQLite credentials directly and does not establish that saved credentials
      are invalid; make no provider request as part of TL322.
- [x] Supersede the TL324 provider-specific selector after the owner chose one
      provider-agnostic adapter for stored `openai-compatible` and
      `anthropic-compatible` node types. Keep the TL324 completion receipt as
      historical evidence; its old OpenAI-only endpoint selection is no longer
      normative. Do not archive either prior package as released work.
- [ ] If authorized, refresh stale references in the superseded
      `add-apinex-zero-price-source` and `fix-apinex-native-node-type` delta
      docs that still point to the generic package's former active path. Keep
      their APInex-specific requirements historical and inactive.
- [x] Complete local `generic-compatible-model-metadata` implementation and
      fresh independent review. The reviewer found no actionable findings.
      Focused compatible metadata, discovery, capability, endpoint-schema,
      models.dev pricing, and benchmark-hook tests pass 89/89. Strict OpenSpec,
      focused lint, and `git diff --check` pass. Prettier passes changed files
      except `src/app/api/provider-nodes/[id]/route.ts`, whose clean-base source
      also fails formatting; unrelated existing formatting was left untouched.
      Core typecheck still has 720 diagnostics exactly matching the clean base;
      none is in a changed production module. The existing models.dev live-API
      test made a public catalog GET; compatible endpoints used fixtures. No
      local app/image build,
      provider request/completion, runtime mutation, or credential access was
      performed for this local slice. The provider-agnostic requirements are
      merged into `openspec/specs/compatible-model-metadata/spec.md`, and this
      package is archived at
      `openspec/changes/archive/2026-10-30-generic-compatible-model-metadata/`.
- [x] Complete the separately authorized GitHub ARM64 runtime/build/release
      gate and protected deployment on current main source
      `455442b057542c857425d986853745b16e244543`. Run `40969961834` passed the
      emitted `--check-runtime` with `--network none` (1.2s), parity, and
      publication; transaction `40969961834-1` deployed healthy image
      `ghcr.io/etcetera-agency/omniroute@sha256:b50091e18c7e61ac89e54ddc23d2484dafea2d7627e48492ebeccce3c18a5aa3`
      with config digest
      `sha256:603b8d65b894ac8b5b828f87280141298a7fc9b1144668d8d0fb9cc15313bd32`
      on official base
      `b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c`.
      Host migration table is at 216 and the current benchmark set is
      `latest_model_benchmark_evidence_current_set`; this 216 is not the
      `request_cost_ledger` count (48 old rows). Protected pre-deploy DB backup
      is mode 0600, integrity `ok`, SHA-256
      `10529d76d0433bd773caa56ac4e0d626d112ba5567dba364f5507f04ee324784`.
      Rollback pairs it with prior image
      `1fc83c89305870786ca6c9ee7b6f794f53b65ee2d2c04ccf448a83a18e40d67b`
      and source `e5be44c4080f228bc022ac9f821e073faddf80a8`. This closes the
      emitted runtime and deployment gates; native free-only completion is
      recorded separately above.
- [x] TL316 one-time GitHub ARM64 bundle diagnostic: run `40965497429` on
      source `ea46cc92b53d211b4830df3b903ccfe5d1e80192` exported all 499 emitted
      `.mjs` files and esbuild metafile `reprocess-model-benchmark-search.meta.json`.
      Artifact `12938431477` digest was
      `sha256:eb3c0b0e90465d3373b5370ef70f95b457da6f56a28c5bfb55361a569d8962fd`
      (3,700,936 bytes); TL329 inspected the exact bundle and found the SCC
      above. Artifact `12938431477` and unintended Buildx `.dockerbuild` record
      `12937922420` were deleted; both GitHub artifact APIs return 404. Local
      extracted bundle/metafile copies were removed after the passing normal
      runtime check. The temporary diagnostic workflow and scratch target are
      removed. Existing image, CI, and Quality workflows remain disabled.
- [x] Local import-boundary correction passed independent review. The source
      graph regression passes on the corrected tree and fails on clean base
      `0c316b9`; focused adapter, capability, endpoint, pricing, Claude, and
      benchmark tests pass 109/109. Typecheck has the same 720 diagnostics as
      base. This was source-level evidence at that point; GitHub run
      `40969961834` later completed the emitted-artifact check above.
- [x] Trace and record the separate pre-existing import-time usage migration
      path: `modelBenchmarkSearch.ts` → `executeWebSearch.ts` →
      `open-sse/handlers/search.ts` → `usageDb.ts` → `usage/migrations.ts`.
      The last module invokes migration/archive work on import under its existing
      disk-persistence condition. GitHub logs show SQLite initialization but do
      not isolate which call opens it. This local correction does not change
      that behavior or claim the runtime check is side-effect-free.
- [ ] Exercise live Anthropic-compatible metadata discovery separately;
      current support is fixture-tested and has no live receipt. Retain the
      pre-existing import-time usage DB migration path and exact native
      `request_exhaustion` / generic availability-subreason diagnostics as
      explicit deferred scope. Any behavior change requires a separately
      scoped decision and proposal; no filter change is part of this package.
- [ ] Before the separately authorized generated-override cleanup, verify
      whitelist hash
      `15f674bc4b8baacb3033a25c5220a842c050e060d2f11193aad297e704cb11d1`,
      take a private DB backup, and remove only exact generated key/value/time
      matches under a concurrent-change guard. Preserve unrelated overrides
      and current precedence logic.

## Current benchmark snapshot — 2026-10-29

- [x] Implement normal-sync background refresh over the full fresh canonical
      models.dev catalog. Preserve pricing/capability writes; do not enqueue or
      drain the separate discovery queue from this hook. Calls serialize in
      invocation order and keep their own catalog payload.
- [x] Require all five sources to be complete, valid, and nonempty before
      mutation; use exact raw IDs first, then unique exact names. Replace current
      source/model observations and all four owned native score sources in one
      transaction. Clear all evidence and owned score scopes for removed
      canonical IDs; preserve current non-direct evidence for IDs still present.
- [x] Keep only formula inputs and current source references. Valid HF/queue
      updates replace exact current sets, including valid-empty sets; malformed
      and failed updates preserve prior rows and scores. Do not retain raw JSON
      or changed-value history.
- [x] Migration 200 renames the evidence table, drops legacy `raw_json` for all
      sources, and compacts duplicate rows by the exact existing formula
      observation key. It retains latest `captured_at` with the existing reader
      tie order and preserves distinct observation keys. Legacy source-batch
      boundaries, deleted distinct keys, and successful empty results cannot be
      reconstructed from per-row data.
- [x] Verify raw canonical identity reaches native `model_intelligence` and
      the unchanged actual coding/general band consumer, including inactive
      canonical IDs and separate route-facing provider IDs. Auto filters,
      capability metadata, formula, routing, and free-cost files are unchanged.
- [x] Complete focused integrated regressions, malformed-response coverage,
      independent review, Code Simplifier, and local OpenSpec validation. The
      completion review records exact commands and any local build limits.
- [x] Complete isolated migration 200–216 rehearsal and authoritative ARM64
      build/deployment through GitHub run `40879166447`. Migration, image, and
      benchmark receipts are recorded above and in both canonical completion
      reviews. The current DB/image rollback pair remains protected; rollback
      always restores both, never the image alone.
- [x] Complete normal current-catalog refresh after deployment with direct
      source, canonical-ID, and native-profile receipts above. The refresh made
      no discovery, search, or inference calls. Preserve the pre-migration DB
      snapshot; native free-only acceptance later closed in TL333.

## E013 — native free evidence import and live acceptance (2026-10-31)

- Local implementation is in `openspec/changes/fix-native-free-evidence-import/` on branch `fix/auto-fallback-request-lifetime-20261031`. Exact provider/model source evidence survives beyond 36 hours with original `fetchedAt`; raw models.dev provider IDs use the existing native mapping. Upstream strict-zero policy, dynamic `openrouter/free` exclusion, static catalog precedence, hard stops, and quota checks remain intact.
- E013 updated the fork-owned stale-evidence and raw-provider mapping expectations in `tests/unit/autoCombo/strict-zero-cost-filter.test.ts` and `tests/unit/modelsDevZeroCostEvidence.test.ts`. The separate compatible-pricing TTL is removed without changing capability false-veto or unknown behavior.
- Historical passive run `41224296940` published an image but failed with
  `IMAGE_PULL_FAILED` before app stop. It is superseded as the latest release
  status by run `41247447693` below; retain its receipt without treating it as
  the current deployment failure.
- Guard decisions are approved under TL015: A2+B1+C1 and current source-label recognition. TL015 owns the related completeness, five-snapshot, all-row, and source-label work; these changes remain outside E013.

- Deferred read-only sync audit: the runtime capture around 17:27Z and the post-failure capture retain `models_dev_zero_price.snapshot.fetchedAt=2026-10-29T23:31:57.808Z`, `model_capabilities.last_synced=2026-10-31T15:36:36.647Z`, and 238 pricing provider rows without a pricing write timestamp. The checked-out writer source at revisions `455442b05754` and E013 `11dda6ef46` preserves source time on cache hits; successful sync can rewrite the snapshot with that same time, and composed read evidence can retain the oldest compatible-source timestamp. That source comparison does not establish which writer the packaged startup loads; see the critical effective-startup gate below. Raw compatible snapshots currently span `2026-10-31T15:38:21.399Z`–`2026-10-31T15:38:23.886Z`. Determine startup rewrite/recomposition and later periodic-timer behavior from passive evidence; these timestamps alone establish neither sync failure nor absence of recalculation. Do not force sync or make provider/model calls.

- Historical pre-P1 artifact capture found the BASE root entry loading chunk `68236`
  instead of overlay chunk `65453`; the source-built OVERLAY packaging fix and
  final-stage COPY correction are now accepted and integrated. This old capture
  is not OCI/runtime proof. The later run `41247447693` published the selected
  immutable image but deployment failed before stopping the current app; see the
  current acceptance record at the end of this file.
- Preserve the prior storage-recovery receipt, every rollback pair, and the
  3,159,546,880-byte diagnostic archive at its preserved path. Latest reported
  free space is 1.41 GB at root and 7.19 GB under `/var/oled`; do not clean up or
  create a separate storage gate from these figures.

- Superseded passive sync uncertainty: the earlier timestamp captures above
  remain historical; they did not by themselves establish recalculation. The
  owner-selected OVERLAY design and current runtime gates are recorded below.
  Do not force sync or make provider/model calls.

## TL015 — benchmark source isolation (2026-10-31)

- [x] Implement selected A2+B1+C1 locally: direct source errors/incomplete
      results retain status and continue to Hugging Face then existing Ollama Search
      only without usable evidence; partial snapshots replace only successful
      nonempty datasets; normalized rows validate independently and replace by the
      existing fitness observation identity. The approved
      `ollama-search-structured-output` family mapping is active; scoring formulas
      are unchanged.
- [x] Add offline regressions with mocked source/provider fetches, actual SQLite
      transaction rollback, post-commit cache invalidation, row rejection,
      observation replacement, and current normalized-source fitness. No
      billing-test acceptance or live API/network request was made or claimed.
- [x] Independent sequential read-only review completed by reviewer
      `01a1934b-81be-72c1-b4c4-794ff034adc3`: no concrete source bugs or
      additional concrete test gaps. Its single P3 documentation finding is
      corrected by the explicit historical-ID clarification in completion.review.
      The final unfiltered 68/68 result was accepted without rerunning tests.
- [x] Resolve the hook blocker with the owner-authorized minimal fork-test fix:
      remove only unused `init` from the fetch mock in
      `incomplete Hugging Face feeds preserve current evidence and native scores`.
      That exact offline test passes 1/1; focused six-file ESLint passes. Production
      source is unchanged; prior unfiltered 68/68 and independent source review stand.
- [x] Owner accepted source, unfiltered 68/68, independent review, and P3
      clarification. PR57 is merged and its accepted source is integrated in
      current main. Task 9 is only the GitHub release, protected deployment, and
      passive runtime receipt; source/tasks 1–8 are complete.
- [ ] Task 9 remains open because run `41247447693` built and published the
      immutable image but protected deployment failed with
      `COMPOSE_RUNTIME_MISMATCH`. This is not awaiting new source work or parent
      acceptance of the source. Retry only the existing immutable artifact after
      the pending owner health-policy answer and parent retry grant; do not start
      another build. Runtime proof remains distinct from local 68/68/review.
- Focused core typecheck exits 1 with 712 repository diagnostics, none in the
  three modified production modules. The prior focused ESLint unused `init` finding at
  `tests/unit/modelBenchmarkSearch.test.ts:1525` is resolved by the explicitly
  authorized one-parameter mock cleanup; focused six-file ESLint now passes.
- [x] Final unfiltered three-file Node run (no `--test-name-pattern`) passed
      68/68 in 163.3s with the isolated temp-DB harness and fixture-mocked fetches.
      Command:
  ```sh
  ESBUILD_BINARY_PATH=/srv/projects/hermes/.worktrees/omniroute-ind206-build-provenance-recovered/node_modules/@esbuild/linux-x64/bin/esbuild node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit --test-reporter=spec tests/unit/modelBenchmarkSearch.test.ts tests/unit/modelBenchmarkSearch.catalog.test.ts tests/unit/modelBenchmarkFitnessSync.test.ts
  ```
  The three failures from the first unfiltered run each passed on baseline
  `062c948280e1` (PR56 docs-only successor); the relevant code/test files match
  source base `0bf99c1aeae1`. Final package run is green after scoped corrections.

## TL013 startup artifact and APInex strict-output follow-up (2026-10-31)

- [x] Confirmed cause from actual live artifact `455`: base instrumentation
      loads the BASE pricing writer without `models_dev_zero_price`; the correct
      OVERLAY writer is unused. The native pricing table is lossy (`missing → 0`)
      and cannot replace the unchanged explicit-zero proof getter. The minified-base
      patch was rejected.
- [x] Owner selected full source-built OVERLAY startup; source integration and
      local review are accepted. Packaging delegates official root
      `server/instrumentation.js` to the selected overlay's compiled entry,
      preserving its relative chunk tree and official UI. The integrated source
      descends from accepted startup commit
      `276fd8d856d47b2d7d1f447e7bd856e2090caf63` and is present in current main
      `dcc79e26476434ef0e0bcb5d49be50798c58c0fd`. Runtime proof remains open.
- [x] P1 confirmed: the final runtime stage discarded the generated root entry.
      The explicit merged-backend COPY and actual final-stage fixture regression
      were accepted: historical RED 1/1, GREEN 11/11, native chain 5/5, rereview
      with no findings. These local receipts do not prove the OCI artifact.
- [ ] Runtime gates remain open after run `41247447693` published the immutable
      image and protected deployment failed with `COMPOSE_RUNTIME_MISMATCH`.
      Verify source/digest/`BUILD_SHA`, the delegated root entry and complete
      overlay dependency tree, native periodic writer activation, and passive
      fresh metadata only after an authorized retry. Parent accepted the local
      source integration; retry still needs the pending owner health-policy
      answer and parent retry grant. No new build is authorized.
- [ ] SUSPENDED / owner-dependent startup health policy: the pending owner
      decision covers manual price/structured-output tests only versus also
      allowing stock automatic credential-health checks after restart. The
      earlier `OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK=true` environment delta
      was parent implementation work, not an owner requirement; it was safely
      reverted and is not a required gate. Do not restart or retry deployment
      until the owner answer and parent grant arrive.
- Deferred upstream behavior, not a current fix task: native global
  `credentialHealthCheck.intervalMinutes=0` suppresses periodic checks but does
  not prevent the initial credential-health sweep after its 30-second startup
  delay. Do not investigate or change it in this slice. If the owner selects a
  policy that disables those automatic startup checks, track the initial-sweep
  behavior as a separate upstream bug. Per-connection health interval `0` is
  supported; no bulk writes are authorized or required for 34 connections.
- A successful native models.dev startup sync is immediate and nonblocking when
  saved `modelsDevSyncEnabled=true` (or `MODELS_DEV_SYNC_ENABLED=1`) and
  `syncCapabilities` defaults true; it writes the raw zero-price snapshot and
  asynchronously refreshes public benchmark metadata, including AA only when
  its API key is available. Saved `false` pauses this whole sync chain. These
  source behaviors are covered only with offline fixture fetches; current
  production saved setting and AA key presence remain unverified. The catalog
  refresh does not claim or drain benchmark-search work, and no normalizer or
  inference runs in the tested chain.
- [x] Related TL013 APInex inspection found saved metadata for exact catalog ID
      `free/deepseek-v4.1-flash` has strict-output absent and the resolver returns null;
      a prior strict-JSON HTTP 200 exists. Raw source was not retained, so field
      loss is not proven. Do not classify strict-output as unsupported.
- [x] The owner rejected targeted/per-model strict-output override. TL013's
      read-only provenance audit and one authorized native metadata resync are
      recorded below. No capability-source edit, inheritance, backfill, inference,
      probe, search, benchmark, or queue work occurred. The raw APInex enriched
      catalog declares no structured-output field; exact unknown-policy decision
      remains with owner. No billing-test gate is added or claimed.

## Compatible structured-output handoff (2026-10-31)

- Source accepted by independent review: no code findings; full affected tests 22/22, scoped lint/format/OpenSpec/diff checks passed. Package `openspec/changes/fix-compatible-structured-output-handoff/` remains unarchived on `fix/compatible-structured-output-handoff`, exact base `062c948280e1e3e6191c7a6f48a2f1aea2854eb6`. This correction changes docs only.
- APInex source evidence remains unresolved: normalized saved snapshots for exact IDs `free/deepseek-v4.1-flash` and `deepseek-v4.1-flash` omit structured output; raw catalog payloads were not retained. Absence in normalized snapshots does not prove raw field loss or raw source omission. Historical strict-JSON success permits no backfill, base-model promotion, cross-provider inheritance, or override. A native source without a declared boolean cannot fill this capability.
- Deferred vision false preservation: `modelDiscovery.ts:741` and `db/models/synced.ts:140` emit `supportsVision` only when true, dropping explicit false from synced rows. The authoritative compatible snapshot retains false, so current resolver false veto remains effective. Track a separate failing regression and scoped shared-handoff fix; no adjacent source fix belongs to this accepted structured-output patch.
- Reviewer-authorized read-only DB capture at `2026-10-31T19:02:52.118Z` found exact `model_id=deepseek-v4.1-flash`: `structured_output=true` for `provider_id=opencode-go` and `opencode-zen`, false for `alibaba-token-plan` and `ollama-cloud`. All four rows have `last_synced=2026-10-31T15:36:36.647Z`. These are different provider/model tuples, with no same-tuple conflict or inheritance. No requery was performed for this correction.
- [x] Earlier planned per-connection `GET /api/providers/{connectionId}/models?refresh=true&excludeCustom=true` was unnecessary: the one-time native sync produced fresh source/snapshot/synced receipts for all four active compatible connections. The compatible refresh branch at `route.ts:419` remains catalog-GET-only (OpenAI-compatible up to three URLs; Anthropic-compatible up to 20 pages); no inference call.
- Owner authorized ordinary stock derived `qtSd` and `auto:discovery` writes during native catalog reimport; completed sync kept hooks enabled and before/after effects are captured below. Persistence uses `notifyQuotaCombosForProvider` (`quotaCombos.ts:237`) and `contextWindowResolver.ts:104`; these local hooks make no provider requests.
- [x] Historical capture of native source `capabilities.structured_output`
      presence and exact IDs, snapshots, synced rows, resolver outcomes, combos,
      and overrides around the one authorized import. No provider/config
      additions, benchmark refresh, queue/search/normalization flow, or probes
      occurred. Startup selection was pending then; owner later selected
      OVERLAY as recorded below.

- Integrated source checkpoint: local feature commit `5dd353e3ae` merged authorized `origin/main=e7be7311342608661a1b14b989019b441261eeb6` (PR57) with only manual root-doc concatenation; both root histories preserved. Integrated offline Node batch passed 144/144 with zero skips; strict filter 19/19. `npm run typecheck:core` on both a fresh exact-main archive and integrated tree returned exit 2 with the same 712 byte-identical diagnostic lines, zero new diagnostics. No upstream type debt repair or startup change.
- [x] One-time native sync with the body above completed after standard dashboard auth. It wrote native pricing and the canonical zero snapshot, skipped capability save/benchmark refresh, and imported all four active compatible connections with stock hooks. `PROXY_AUTO_SELECT_ENABLED` is unset/effectively false, so optional OpenAI catalog HEAD path was inactive. No periodic interval started; request-local timers and reconciliation settled. See exact backup and before/after receipts in the acceptance section below.
- [x] Historical post-deployment capture recorded emitted routes, protected DB
      backup, zero/pricing evidence, active connection imports, dependent rows,
      strict-free settings, and settled hooks. It made no inference, search,
      benchmark, or normalizer request. The one-time import left the old BASE
      periodic zero writer unfixed; the owner later selected OVERLAY startup.

## Historical TL013 exact-main deployment and metadata capture (2026-10-31)

- [x] Historical PR58 receipt: accepted source `35535ca87bcdcbb851f0442a67aaf2222ea1d0a8` was deployed in run `41235613024`, with successful ARM64 build, artifact/runtime check, UI parity, immutable publish, and protected deploy. Its image remains the old healthy runtime after later run `41247447693` failed before app stop. Workflow `373883666` is disabled. Image: `ghcr.io/etcetera-agency/omniroute@sha256:6a456abf3c4ae5ccb52e157172768f3e1a365b80233df3e8be7e81b07fd07253`.
- [x] Runtime is healthy on that digest and exact `BUILD_SHA`; effective emitted route files were verified at `/app/.build/next/omni-overlay/server/app/api/settings/models-dev/route.js` (SHA-256 `478ac4b69471516d19bf2c0a2bd0c739e9f52ae16198cb915d5a65fc5bdcca94`, sync marker present) and `/app/.build/next/omni-overlay/server/app/api/v1/auto-combo/[channel]/candidates/route.js` (SHA-256 `74aa7998236985f8abb65ee6ff8c74bcc3a21ac826c1b234dcf92497909be826`, strict marker present). Old app container exited `2026-10-31T20:00:15.557161245Z` (143); new container started `2026-10-31T20:00:19.138980479Z`, restart count 0 at final read. Redis stayed healthy on original image. BASE startup command remains unchanged. Paired rollback material and 3,159,546,880-byte diagnostic archive remain preserved; no cleanup. Latest root free space was 3,123,126,272 bytes; `/var/oled` free space 7,194,427,392 bytes. The direct restart-gate warning did not reach TL013 before old-app stop.
- [x] First sync POST returned HTTP 403 before handler execution; original response bytes and correlation ID were not retained. `AUTH_001` with “Invalid management token” is the source response for the invalid-management-bearer branch, not the observed original body or confirmed cause. The API-key/hash mismatch was source diagnosis only; it does not establish why that request failed or rule out other controls. A later standard dashboard login/session, same-origin request, and CSRF header were accepted for the single authorized sync; no new credential, JWT, permission, config, or guard change.
- [x] Exactly one authorized native POST then completed: `{"action":"sync","dryRun":false,"syncCapabilities":false}`. Response HTTP 200, `success=true`, 9,829 models, 238 providers, 0 capability writes. Existing native sync returned before any periodic start/stop call; `periodicEnabled=false` remains. No retry, inference, provider/model probe, benchmark, search, queue, or normalizer work.
- Protected before backup `/var/oled/omniroute-deploy-diagnostics/e013-41235613024-dashboard-auth-pre-sync.sqlite`: 95,899,648 bytes, mode 0600, SHA-256 `fcfd8950cb3ce9d624ed16bf095f4522d3e4c87e06a2c0f8771892aeb6834b7d`. Before capture `e013-41235613024-dashboard-auth-before.json`: 9,162 bytes, SHA-256 `5764fb5948d293f86680e2c41dee46c0d6f5ecde387e465238381a7ea18d8581`. After capture `e013-41235613024-dashboard-auth-after.json`: 9,731 bytes, SHA-256 `a33c0c6ccd8b7fe4237bff0553821d7e402bb9210a4c3c8e4069a922ab0cf24c`.
- [x] All four active compatible connections have post-sync native source, snapshot, and synced receipts: Caprover `caprover-local-fast` (1 model; `20:28:08.359Z`), Caprover `caprover-uacore-local-fast` (1; `20:28:10.490Z`), AIHubMix connection `13596fa2-252b-41e7-8bad-7665b5722194` (660; `20:28:12.738Z`), and APInex connection `9565fb26-817c-42b4-baa0-b76733a951c4` (44; `20:28:12.896Z`). Both snapshot and synced timestamps were checked per connection. No imported catalog declares `structured_output`; compatible target rows stay unknown, with no override or inheritance. AIHubMix snapshots and both Caprover catalogs have no structured-output property.
- APInex was fetched once from the exact native enriched URL `https://api.apinex.bond/api/public/models` (HTTP 200); inspected JSONPath `$.models` (44 rows) and exact row-key set `allowFree,contextWindow,dollarsPer1M,health,id,name,outputDollarsPer1M,provider,supportsTools,supportsVision,tags,weight`. `structured_output` and JSON-schema capability fields are absent from those raw rows. Exact IDs `deepseek-v4.1-flash` and `free/deepseek-v4.1-flash` remain unknown. This is not evidence from `/v1/models`, and prior HTTP 200 strict-JSON output does not grant backfill authority.
- Canonical zero snapshot now records actual `fetchedAt=2026-10-31T20:28:08.276Z`, provider key `kilocode` with 20 IDs and no `kilo` key (prior: stale `2026-10-29T23:31:57.808Z`, 21 IDs under `kilo`). Pricing table has 380 `kilocode` rows. Last sync reports 9,829 models, 238 providers, zero capability writes; current aggregate status was 9,873 models / 239 providers / 10,233 capability rows. Free policy remains strict; model lockout remains enabled for 403/404/429/502/503/504, base 120,000 ms, max 1,800,000 ms, 10 exponential steps; combo timeout 1,200,000 ms; gateway proxy/server envs 0 and `REQUEST_TIMEOUT_MS` unset.
- Stock bookkeeping settled with no delta: LKG pool rows 32; APInex session history 2; session affinity, proxy assignments/rotation, quota-pool membership, and `qtSd` combos unchanged/empty; `auto:discovery` overrides stayed 0 for both `auto/coding_high_tools:free` and `auto/general_high_so:free`. Hooks remained enabled. Free metadata eligibility is not billing proof.
- At the initial post-sync capture, the Native Auto candidate endpoint had not yet been called. Current strict-cache refresh invokes `getUsageForProvider(..., { forceRefresh: false })`. Exact active branches show quota/account/catalog metadata reads, including allowed metadata POSTs for AGY/Antigravity; Antigravity model generation requires `forceRefresh === true && creditsMode === "always"`, so candidate refresh cannot reach it. No enrollment, provider probe, or inference ran. The later native-auth candidate evidence is recorded in the continuation below. Historical 9-row diagnostic had 6 `not-in-catalog` and 3 `state-unknown`; `reachable=true && excluded=false` is never an executable count. Historical order for `6dc4` remains unknown.
- Policy decision resolved by owner: keep this fork's existing `OMNIROUTE_AUTO_BANDS_CONFIG.capabilities.so.unknown=deny`; no config/source change. It is not an upstream native-band setting (`bands/capabilities.ts` is absent upstream); stock combo admission rejects only explicit `structured_output === false`. Explicit false and free-only behavior stay unchanged. APInex's exact enriched raw catalog has no `structured_output` in 44 rows; its exact free/base targets remain unknown and are not structured-output-band eligible. `response_format` is recognized; false is incompatible, null passes. Quality validation checks response body/string/JSONPath, not caller JSON Schema; HTTP 200 invalid JSON/schema has no generic schema-based retry guarantee. This is a current limitation, not validator work; schema validation is future work only if desired and does not block the deny decision. Gemini translates `responseSchema`; Claude adds a prompt instruction; no common all-provider structured-output/schema guarantee exists.
- Historical state: BASE periodic zero-writer defect was present and the
  full-OVERLAY startup choice was still pending at that audit point. Owner later
  selected OVERLAY and source integration is accepted. Prior PR59 status is
  superseded by the current main/runtime record below; no required-check bypass
  is implied. See retained review receipts in the archived package and root
  `completion.review`.

## TL013 candidate-only acceptance continuation (2026-10-31)

- [x] Correct usage-leaf diagnosis: a missing/stale strict quota cache can asynchronously call getUsageForProvider(..., { forceRefresh: false }). Current active agy/antigravity, Kilo Code, Jina, Ollama Cloud, OpenRouter, and Tavily branches are quota/account-metadata reads; Antigravity streamGenerateContent probe is gated by forceRefresh === true && creditsMode === "always" and is not reachable from candidate refresh. Exact URL paths, payload keys, current branches, and OpenRouter's process-local limiter update are in root completion.review.
- [x] Used the existing password login and CSRF contract over SSH Node after validating the current `INITIAL_PASSWORD` against the stored bcrypt hash; no credential values were printed. Two native candidate GETs returned HTTP 200 for each approved band; after a 45-second usage-cache wait, passive GETs returned the same counts. `auto/coding_high_tools:free`: 24 account diagnostic rows, 21 unique provider/model candidates; account-row `freeAccessExclusion` reasons null 18, `state-unknown` 5, `not-in-catalog` 1; unique logical-candidate reasons null 18, `state-unknown` 2, `not-in-catalog` 1. `auto/general_high_so:free`: 9 account rows, 7 unique candidates; account-row reasons null 5, `state-unknown` 3, `not-in-catalog` 1; unique logical-candidate reasons null 5, `state-unknown` 1, `not-in-catalog` 1. A null reason is a native strict-free classifier pass at logical provider/model level; it does not prove SO capability eligibility or per-account orderability. Every row was `reachable=true`, breaker `CLOSED`, `excluded=false`, which is not an executable count. Endpoint exposes diagnostic reasons and connection state, but no final safe IDs, `allowedConnectionIds`, or dispatch order. No inference/provider probe ran.
- [x] Correct the initial 403 record: original response bytes and correlation ID were not retained. AUTH_001 is the source branch's expected invalid-management-bearer response, not a confirmed original body/cause. The later dashboard-authenticated sync succeeded once; that does not retroactively prove the first 403 body.
- [x] Record persisted modelsDevSyncEnabled=true, runtime MODELS_DEV_SYNC_ENABLED=unset and interval unset, and OVERLAY status periodicEnabled=false. The one-time sync action does not start/stop the OVERLAY timer; this field does not prove full-process or BASE-timer state. BASE periodic zero-writer defect remains open. At this capture, full-OVERLAY startup choice remained pending; owner later selected it below.
- PR59 stays open for review; no merge or required-check bypass. Current deployment and metadata sync remain accepted independently of unresolved SO eligibility and per-account orderability.

## TL013 startup delta and candidate-only continuation (2026-10-31)

- Historical startup-choice audit, superseded by the owner-selected OVERLAY
  design above: BASE and OVERLAY shared the same orchestration import sites;
  only `modelsDev` and cleanup bindings differed. No new production hook is
  proposed or required.
- Latest capture window `2026-10-31T20:37:12Z–20:49:32Z`: background/headless-disable vars unset, persisted `modelsDevSyncEnabled=true`, models.dev env vars unset. OVERLAY local timer status `false` does not establish BASE timer status. BASE periodic zero-writer defect remains open; no timer/config/source change.
- Historical startup-health capture: both BASE and OVERLAY include the
  credential-health flow shown above; at that capture health-disable was unset,
  global default 60m, initial delay 30s, and no request was executed or observed.
  Current owner policy is still pending; do not treat this historic capture as
  authorization to restart or run a provider test.
- No new production startup hook is proposed. Earlier deployment/metadata
  acceptance and candidate diagnostics remain historical receipts; runtime
  state is governed by the current run and exact gates below. Do not treat
  candidate diagnostics as inference or orderability proof.

## TL013 shared models.dev structured-output fallback (2026-10-31)

- [x] Owner-selected common resolver policy: the exact requested provider,
      connection, and model's native structured-output boolean wins, including
      `false`. Only when native value is absent, any models.dev row with the
      same canonical model ID and explicit `structured_output=true` returns
      true. Other rows' false/null/absence do not veto; no true evidence remains
      unknown. `tool_call` is neither evidence nor prerequisite. This selection
      supersedes the prior no-cross-provider-inheritance statement only for
      exact same-ID models.dev structured-output fallback. Per-model overrides,
      APInex gates, paid fallback, and billing gates remain out of scope.
- [x] Local E013 implementation on
      `fix/structured-output-modelsdev-fallback`, based on approved main
      `35535ca87bcdcbb851f0442a67aaf2222ea1d0a8`. Existing resolver now checks
      build snapshots or the established models.dev all-row cache after native
      sources. Known `free/<model>` identity uses the exact existing resolver.
      Unknown remains `null` for the current fail-closed band filter.
- [x] DATA E013-so-sources: one public models.dev metadata GET and DB capture show exact ID
      `deepseek-v4.1-flash` declared true by `opencode-go`/`opencode-zen` and
      false by `alibaba-token-plan`/`ollama-cloud`; raw audit was 23 true and 2
      false among 25 exact-ID records. This implementation used offline fixtures without repeating the GET or DB
      capture. Owner selected the policy; DATA E013-so-sources supplied the data.
      Fresh inference, forced-tool calls, and billing acceptance are currently
      forbidden and are not metadata completion gates.
- [x] Strictly validated and locally archived OpenSpec change as
      `openspec/changes/archive/2026-10-31-fix-modelsdev-structured-output-fallback/`;
      merged shared contract is `openspec/specs/model-capability-resolution/spec.md`.
      Local spec archiving is not deployment or runtime acceptance.
- [x] Parent accepted source integration and the archived SO fallback remains
      archived. Run `41247447693` already built and published its immutable
      artifact; protected deployment failed with `COMPOSE_RUNTIME_MISMATCH`.
      This historical package is not reopened or remerged. Passive runtime proof
      is tracked by the current E013 release gate below, not by a pending parent
      source-acceptance step.
- [ ] SUSPENDED / owner-dependent: historical fresh inference, forced-tool-call,
      and billing acceptance items are currently forbidden and are not required
      to finish fallback metadata. Deferred compatible vision-false preservation
      remains a separate TODO.

## E013 current release and runtime closure status (2026-10-31)

- Accepted source integration `23d71601e2175282cfee4ac8e6d8b018f666411a` includes
  PR59 audit `1a9ee3241d0e9171df1747cd5e9e0e3e42931dc2`, structured-output source
  `044bf3e4f78749f0ececafad37bec538bbe011c9`, and source-built startup
  `276fd8d856d47b2d7d1f447e7bd856e2090caf63`. Canonical GitHub `main` is
  `dcc79e26476434ef0e0bcb5d49be50798c58c0fd`; its tree matches the accepted
  integration. TL015 PR57 and source tasks 1–8 are accepted; task 9 is the
  GitHub release, protected deployment, and passive receipt only.
- GitHub run `41247447693` built and published immutable image
  `ghcr.io/etcetera-agency/omniroute@sha256:52d86f2c8b9847088a5e2b37ac7c5a82a429a6f1ff22f6cfed5014ab140407e7`.
  Protected deployment failed with `COMPOSE_RUNTIME_MISMATCH`,
  `failed_before_stop=true`, and `candidate_may_mutate=false`; the app was not
  stopped and no rollback occurred. Existing runtime remains healthy on source
  `35535ca87bcdcbb851f0442a67aaf2222ea1d0a8`, image
  `ghcr.io/etcetera-agency/omniroute@sha256:6a456abf3c4ae5ccb52e157172768f3e1a365b80233df3e8be7e81b07fd07253`.
  Workflow `373883666` is disabled. No new source work or parent source
  acceptance is pending; any retry is job-only against this immutable artifact.
- The one `OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK` env delta was parent
  implementation work, not an owner requirement. It was safely undone using the
  protected backup. Restored `.env` SHA-256 is
  `47172471b491d99700060b2eb54577794ef04726d855a949e4cc2fe036a374d0`; protected
  flag-copy SHA-256 is
  `b6b2b7e97a377adc07a8945bea4426149609159935bd432a223921c8760da42b`. Do not
  infer that this flag is required. The owner decision remains pending: whether
  the current prohibition covers manual price/structured-output tests only, or
  also stock automatic credential-health checks after restart. Do not restart
  or retry until that answer and a parent retry grant.
- Deferred upstream behavior, outside this slice unless selected by the owner:
  native global `credentialHealthCheck.intervalMinutes=0` suppresses periodic
  checks but does not prevent the initial sweep after its 30-second startup
  delay. Do not investigate or fix it here. Per-connection health interval `0`
  is supported; no bulk writes are authorized or required for 34 connections.
- Exact passive runtime gates after any authorized retry:
  1. Bind reviewed source SHA and immutable image digest to actual runtime
     `BUILD_SHA`; prove official root `server/instrumentation.js` delegates to
     the complete source-built overlay dependency tree.
  2. Prove selected startup runs native models.dev periodic sync with the saved
     setting enabled, writes a fresh zero-price snapshot, and uses canonical
     provider `kilocode`.
  3. Prove APInex configured API base remains exact and the approved free/base model's
     structured-output capability resolves `true` through native metadata or
     the approved same-canonical-ID models.dev `true` fallback. Raw APInex
     absence alone is not the final resolved result.
  4. Read back strict-free policy, native model lockout enabled with codes
     `403,404,429,502,503,504`, `comboDefaults.comboTimeoutMs=1200000`, both
     bridge timeout settings `0`, `REQUEST_TIMEOUT_MS` unset, and models.dev
     periodic interval at its native 24-hour default.
  5. Capture passive runtime health and metadata receipts. AA metadata refresh
     is allowed if configured; it does not authorize inference.
- Current ban remains: no manual LLM, price/structured-output, normalizer,
  search, forced-tool, or billing probes. These future owner-dependent actions
  are SUSPENDED and are not package-closure requirements. No required GitHub checks are configured;
  that is a repository fact, not a permission gate. Preserve all rollback pairs
  and the diagnostic archive; do no cleanup. Latest reported free space is
  1.41 GB at root and 7.19 GB under `/var/oled`.
