## 1. Branch bootstrap

- [x] 1.1 Create `feat/auto-quality-bands` from upstream `release/v3.8.52` at `23a11484862b3bb589a55e85b00e4ac53ffeb234`.
- [x] 1.2 Add fork-only `openspec/` and move the three proposals into `openspec/changes/`.
- [x] 1.3 Run `openspec validate add-auto-band-seam --strict`.
- [ ] 1.4 Start the unmodified upstream build on a copy of the production database; record the migration runner output.

## 2. Failing tests first

- [ ] 2.1 `bands-grammar.test.ts`: valid and invalid `<task>_<band>[_<cap>...]` forms; capability order ignored; duplicate or unknown capability rejected.
- [ ] 2.2 `bands-seam.test.ts`: with the flag on, a band suffix with omitted tier defaults to `thrifty`; with the flag off, it remains unset; explicit `:free` is retained; plain upstream `auto:thrifty` remains unchanged; after toggling off, no band filter/order/reserve hook mutates the pool; declared hooks in `suffixComposition.ts` and `virtualFactory.ts` carry `AICODE-NOTE: bands seam`.
- [ ] 2.3 `bands-identity.test.ts`: table of upstream ids (`coding`, `coding:fast`, `vision`, `reasoning:pro`, `bogus`, `coding:bogus`, `a:b:c`) gives the same `parseAutoSuffix` result and the same `buildAutoCandidateFilter` verdicts as the unpatched functions.
- [ ] 2.4 `bands-contracts.test.ts`: `getTaskFitnessWithSource` shape and sources; `createVirtualAutoCombo` accepts an opaque category; `getComboForecastUsageRows` and `getQuotaSnapshots` row fields; chat-path virtual combo name equals the requested id.
- [ ] 2.5 Chat-path test: `auto/coding_high` and `auto/coding_high:free` reach `resolveAutoRoutingState` unchanged.

## 3. Implementation

- [ ] 3.1 `bands/grammar.ts`: task list, band list, capability list, `parseBandId()`.
- [ ] 3.2 `bands/index.ts`: `isBandsEnabled()`, `parseBandCategory()` with degraded mapping, `buildBandCheck()` returning `null`.
- [ ] 3.3 Add parser/filter hooks to `suffixComposition.ts` and the band-only pool hook to `virtualFactory.ts`, with `AICODE-NOTE: bands seam`.
- [ ] 3.4 Run Code Simplifier on the slice.

## 4. Verification

- [ ] 4.1 `bands-*` tests pass; upstream `tests/unit/autoCombo` and `open-sse/services/autoCombo/__tests__` pass unmodified.
- [ ] 4.2 `git diff release/v3.8.52..HEAD --stat` shows only the declared `suffixComposition.ts` and `virtualFactory.ts` upstream integration files.
- [ ] 4.3 Live check: request `auto/general_mid:free`; confirm routing as `auto/chat:free` and `call_logs.combo_name = "auto/general_mid:free"`.
- [ ] 4.4 `GET /v1/auto-combo/general_mid:free/candidates` returns 200.
- [ ] 4.5 Document the rebase procedure and deploy tag naming in the fork deploy playbook.
