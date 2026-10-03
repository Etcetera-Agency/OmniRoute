## 1. Preconditions

- [ ] 1.1 Confirm on production that `call_logs.combo_name` equals the band channel id (slice 1 task 4.3).
- [ ] 1.2 Sample `call_logs` provider/model ids against catalog ids; list mismatches.
- [ ] 1.3 Time the three aggregate reads (24 h, 7 d, 30 d) on the production database.

## 2. Failing tests first

- [x] 2.1 `bands-demand.test.ts`: rows classified by band and `other`; linear forecast; empty history → zero (4 tests pass).
- [x] 2.2 `bands-capacity.test.ts`: precedence live → daily → monthly → none; preserve existing daily pool grouping; shared monthly pool uses the maximum known positive `monthlyTokens` once per `(account, provider, poolKey)` in deterministic catalog order; zero/absent monthly values are unknown and ignored; stale snapshot skipped; missing `next_reset_at` skipped; Radar off → baseline fields only. Identical positive daily caps retain the known axis in either catalog order; differing positive caps still fail the refresh and retain the prior snapshot (7 tests pass; reviewer closed the regression).
- [x] 2.3 `bands-reserve.test.ts`: absolute rule (reserved / not reserved / either `rpd` or `tpd`); live rule with a quota reset inside the lookback; static reserve with no history; top band never reserved; `other` traffic counts as used (14 tests pass).
- [x] 2.4 Account narrowing tests: remove reserved ID A from `[A, B]`, retain candidate with `[B]` before band rung ordering/dispatch; remove candidate if all IDs are reserved; preserve all IDs on missing, stale, or failed snapshot; high band never narrows (independent integration review and 4/4 E2E tests pass).
- [x] 2.4a Kill-switch toggle test: after a snapshot reserves A, disable `OMNIROUTE_AUTO_BANDS`; confirm the adapter still maps a band ID to its native category and preserves an explicit tier (leaving an omitted tier unset), while quality/capability filters, custom band ordering, and reserve narrowing are disabled; keep `allowedConnectionIds` `[A, B]` unchanged (disabled/flag-off paths make no reserve source calls and preserve the pool).
- [x] 2.5 Refresh tests: while reserve is enabled, reads never await refresh I/O; one refresh starts for concurrent reads; failed refresh keeps the previous snapshot until `maxAgeMinutes`. While reserve is disabled, confirm no source reads, reserve calculations, refreshes, or diagnostics occur (covered by the passing reserve suite).
- [x] 2.6 Isolation test: 2/2 focused cases pass and independent review closed without findings. Across isolation, reserve, E2E, demand, and capacity suites, 5 files / 31 tests pass with two workers. Using default adapters, the test exercises a successful enabled refresh, guards Radar sync/scheduler access, performs real catalog lookup, and traps both prepared-statement and `exec` writes on the same DB. Coverage uses an empty feed cache and the static-baseline fallback; the cache-overlay/local-merge branch is not exercised.

## 3. Implementation

- [x] 3.1 `bands/config.ts`: `reserve` block with validation and defaults (13 focused tests; review clear).
- [x] 3.2 `bands/demand.ts`.
- [x] 3.3 `bands/capacity.ts`.
- [x] 3.4 `bands/reserve.ts`: snapshot build and lazy background refresh only while both band routing and reserve are enabled; `isReserved()`, `getReserveSnapshot()`.
- [x] 3.5 `virtualFactory.ts` account seam: narrow `allowedConnectionIds` by reserved scope before band rung ordering and dispatch; remove a candidate only when no allowed IDs remain. Keep plain upstream channels unchanged.
- [x] 3.6 `bands/filter.ts`: combine band membership with reserve availability.
- [x] 3.7 One structured log line per refresh started while reserve is enabled: scopes per source, reserved scopes per band, unmatched usage share, duration. No reserve diagnostics while disabled.
- [x] 3.8 Run Code Simplifier on the slice.

## 4. Verification

- [x] 4.1 Final `bands-*` and upstream autoCombo/service tests pass (41 files / 372 tests; reserve account-routing E2E 4/4; core and OpenSSE typechecks pass).
- [x] 4.2 The upstream integration is limited to the approved band seam in `suffixComposition.ts` and `virtualFactory.ts`, plus the band-scoped selector extension in `resolveAutoStrategy.ts` needed to preserve billing-rung order through strategy selection and fallback. Plain upstream routing remains unchanged. The full Auto-Combo and service suite passes 41 files / 372 tests; independent review closed routing, reserve, and calibration findings.
- [x] 4.3 Verify the default and disabled configuration performs no reserve source reads, calculations, refreshes, diagnostics, or account narrowing.
- [x] 4.4 Verify an explicitly enabled reserve uses the agreed monthly shared-pool maximum once per account/provider/pool key, independent of catalog iteration order; preserve existing daily `rpd`/`tpd` behavior and grouping. The user approved maximum known positive monthly limit; the identical-daily-cap regression is fixed and independently reviewed.
- [x] 4.5 Update the deploy playbook: config block, explicit enablement, disabled-state behavior, and rollback.
