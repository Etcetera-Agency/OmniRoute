## 1. Branch bootstrap

- [x] 1.1 Create `feat/auto-quality-bands` from upstream `release/v3.8.52` at `23a11484862b3bb589a55e85b00e4ac53ffeb234`.
- [x] 1.2 Add fork-only `openspec/` and move the three proposals into `openspec/changes/`.
- [x] 1.3 Run `openspec validate add-auto-band-seam --strict`.
- [ ] 1.4 Complete the unmodified upstream Node 24 build/start smoke on an isolated production-database copy; record migration output and reconcile the observed migration-history overlap before deployment.
      Isolated-copy rehearsal passed: three-row ledger rekey; missing upstream migrations were replayed, then a second init reported 0 pending; FMO data/schema unchanged; trigger/savepoint rollback checks passed; `quick_check` passed. The optimized Next build remains incomplete. Its `--rm` container metadata is gone and the exact-container journal query returned no records, so the failure cause is unrecoverable from this attempt. No retry or production change is authorized from this checkpoint. Preserve task/container logs for any future build/start gate; see `openspec/TODO.md`.

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

- [ ] 4.1 The routing-priority suite passes 7/7, including regressions for selector order, exact account narrowing, quota-cutoff terminal fallback, and flag-off behavior; 27 direct resolver, streaming, and quota tests pass. The latest Auto-Combo run passed 208 tests in 28 files, but `bands-reserve.test.ts` could not start because the reserve module was not present during the concurrent implementation. Rerun the complete suites after that module lands.
- [x] 4.2 The diff against the pinned upstream base shows the band seam in `suffixComposition.ts` and `virtualFactory.ts` and the scoped selector ordering in `resolveAutoStrategy.ts`; ordinary upstream auto routing remains unchanged without the band marker.
- [ ] 4.3 Live check: request `auto/general_mid:free`; confirm routing as `auto/chat:free` and `call_logs.combo_name = "auto/general_mid:free"`.
- [x] 4.4 Local candidates-route contract: `GET /v1/auto-combo/general_mid:free/candidates` returns 200 with a valid-key test scope.
- [x] 4.5 Document the rebase procedure and deploy tag naming in `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md`; `check:doc-links` passed (168 docs, 1174 links), plus `git diff --check`.
