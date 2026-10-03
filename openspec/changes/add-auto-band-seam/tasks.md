## 1. Branch bootstrap

- [x] 1.1 Create `feat/auto-quality-bands` from upstream `release/v3.8.52` at `23a11484862b3bb589a55e85b00e4ac53ffeb234`.
- [x] 1.2 Add fork-only `openspec/` and move the three proposals into `openspec/changes/`.
- [x] 1.3 Run `openspec validate add-auto-band-seam --strict`.
- [ ] 1.4 Complete the separate Node 24 portability build/start smoke on an isolated production-database copy. For production rollout, build and start the exact reviewed commit with the stock Node 26 image on a fresh isolated copy; record migration output and verify the migration-history repair before cutover.
      Copy-only database rehearsal passed: the three-row ledger rekey preserved FMO data/schema, replayed the missing upstream migrations, and a second init reported 0 pending; trigger/savepoint rollback checks and `quick_check` passed. The earlier Node 24 optimized Next build did not complete; its `--rm` container metadata and exact-container journal record are unavailable, so its exit cause is unrecoverable. Two Node 26 builds of staged commit `db18a17c374506941d10fbc58132eb108d1ea5db` failed: attempt 1 (02:57:04–03:08:36 UTC) used a 7 GiB total RAM/swap bound, cpuset 0, and pids 512; webpack step 19 exited 1 with builder `OOM=true`. Attempt 2 (03:26:10–03:34:11 UTC) used heap 4096 MiB with the same limits and cached dependencies; it exited 1 on V8 heap exhaustion near 4066 MB / `SIGABRT`, without a new cgroup OOM event. A third build (03:49:15–03:58:53 UTC) exited 1 as `CANCELED` / `context canceled`, not OOM: the watcher misclassified an approved 9.5-GiB same-container update because it expected exactly 9 GiB, then canceled the build. Logs were retained; no image, production migration, or cutover resulted. Retry 4 ran 04:03:26–04:12:29 UTC after preflight reported 27,403,431,936 bytes free disk and 15,284,174,848 bytes `MemAvailable`. The read-only watcher dry run verified exact container ID, limits, source, and digests. This run used 10 GiB total memory-plus-swap from startup, heap 6144 MiB, two workers, webpack, cpuset 0, pids 512, and a 900-second timeout. A cgroup OOM event occurred at 04:12:22 UTC; the Next worker was SIGKILLed at 535 seconds, builder memory peaked at 9.999/10 GiB, and the run exited 1. Host/disk floors remained clear. No image or start result was produced; production migration and cutover remain unexecuted. Node 24 remains a separate portability baseline, not a production-runtime requirement. See `openspec/TODO.md` and `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md`.

## 2. Failing tests first

- [x] 2.1 `bands-grammar.test.ts`: valid and invalid `<task>_<band>[_<cap>...]` forms; capability order ignored; duplicate or unknown capability rejected.
- [x] 2.2 `bands-seam.test.ts`: with the flag on, a band suffix with omitted tier defaults to `thrifty`; with the flag off, it remains unset; explicit `:free` is retained; ordinary upstream suffixes keep their behavior; the disabled band-order hook returns the original pool without changing account allowlists; reserve narrowing is deferred to its own slice; declared hooks in `suffixComposition.ts` and `virtualFactory.ts` carry `AICODE-NOTE: bands seam`.
- [x] 2.3 `bands-identity.test.ts`: table of upstream ids (`coding`, `coding:fast`, `vision`, `reasoning:pro`, `bogus`, `coding:bogus`, `a:b:c`) keeps native parse results and filter verdicts.
- [x] 2.4 `bands-contracts.test.ts`: `getTaskFitnessWithSource` shape and sources; `createVirtualAutoCombo` accepts an opaque category; `getComboForecastUsageRows` and `getQuotaSnapshots` type fields; virtual combo name/id equals the requested id.
- [x] 2.5 Resolver and virtual-combo contract: `auto/coding_high` and `auto/coding_high:free` reach `resolveAutoRoutingState` with their full id intact and virtual combo identity retains that id. Full successful chat-to-`call_logs.combo_name` proof remains in task 4.3.

## 3. Implementation

- [x] 3.1 `bands/grammar.ts`: task list, band list, capability list, `parseBandId()`.
- [x] 3.2 `bands/index.ts`: `isBandsEnabled()`, `parseBandCategory()` with degraded mapping, and the enabled quality/capability `buildBandCheck()` hook with flag-off pass-through.
- [x] 3.3 Add parser/filter hooks to `suffixComposition.ts` and the band-only pool hook to `virtualFactory.ts`, with `AICODE-NOTE: bands seam`.
- [x] 3.4 Run Code Simplifier on the slice.

## 4. Verification

- [x] 4.1 Final Auto-Combo and service validation passes 41 files / 372 tests, including calibration; core and OpenSSE typechecks pass. Focused routing-priority tests pass 7/7 and direct upstream resolver/stream/quota tests pass 27/27. Independent review closed all five calibration findings and both routing findings. The low-worker final run supersedes an earlier resource-starved parallel run.
- [x] 4.2 The diff against the pinned upstream base shows the band seam in `suffixComposition.ts` and `virtualFactory.ts` and the scoped selector ordering in `resolveAutoStrategy.ts`; ordinary upstream auto routing remains unchanged without the band marker.
- [ ] 4.3 Live check: request `auto/general_mid:free`; confirm routing as `auto/chat:free` and `call_logs.combo_name = "auto/general_mid:free"`.
- [x] 4.4 Local candidates-route contract: `GET /v1/auto-combo/general_mid:free/candidates` returns 200 with a valid-key test scope.
- [x] 4.5 Document the rebase procedure and deploy tag naming in `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md`; `check:doc-links` passed (168 docs, 1174 links), plus `git diff --check`.
