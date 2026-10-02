## 1. Preconditions

- [ ] 1.1 Confirm on production that `call_logs.combo_name` equals the band channel id (slice 1 task 4.3).
- [ ] 1.2 Sample `call_logs` provider/model ids against catalog ids; list mismatches.
- [ ] 1.3 Time the three aggregate reads (24 h, 7 d, 30 d) on the production database.

## 2. Failing tests first

- [ ] 2.1 `bands-demand.test.ts`: rows classified by band and `other`; linear forecast; empty history → zero.
- [ ] 2.2 `bands-capacity.test.ts`: precedence live → daily → monthly → none; pool key grouping; stale snapshot skipped; missing `next_reset_at` skipped; Radar off → baseline fields only.
- [ ] 2.3 `bands-reserve.test.ts`: absolute rule (reserved / not reserved / either `rpd` or `tpd`); live rule with a quota reset inside the lookback; static reserve with no history; top band never reserved; `other` traffic counts as used.
- [ ] 2.4 Account narrowing tests: remove reserved ID A from `[A, B]`, retain candidate with `[B]` before band rung ordering/dispatch; remove candidate if all IDs reserved; preserve all IDs on missing, stale, or failed snapshot; high band never narrows.
- [ ] 2.4a Kill-switch toggle test: after a snapshot reserves A, disable `OMNIROUTE_AUTO_BANDS`; confirm no reserve hook runs and `allowedConnectionIds` `[A, B]` remains unchanged.
- [ ] 2.5 Refresh tests: read never awaits; one refresh for concurrent reads; failed refresh keeps the previous snapshot until `maxAgeMinutes`.
- [ ] 2.6 Isolation test: no call to any Radar sync function; no write to any table.

## 3. Implementation

- [ ] 3.1 `bands/config.ts`: `reserve` block with validation and defaults.
- [ ] 3.2 `bands/demand.ts`.
- [ ] 3.3 `bands/capacity.ts`.
- [ ] 3.4 `bands/reserve.ts`: snapshot build, lazy background refresh, `isReserved()`, `getReserveSnapshot()`.
- [ ] 3.5 `virtualFactory.ts` account seam: narrow `allowedConnectionIds` by reserved scope before band rung ordering and dispatch; remove a candidate only when no allowed IDs remain. Keep plain upstream channels unchanged.
- [ ] 3.6 `bands/filter.ts`: combine band membership with reserve availability.
- [ ] 3.7 One structured log line per refresh: scopes per source, reserved scopes per band, unmatched usage share, duration.
- [ ] 3.8 Run Code Simplifier on the slice.

## 4. Verification

- [ ] 4.1 `bands-*` tests and upstream autoCombo tests pass.
- [ ] 4.2 `git diff release/v3.8.52..HEAD --stat` shows only the agreed `suffixComposition.ts` and `virtualFactory.ts` upstream integration files.
- [ ] 4.3 Production shadow run with `reserve.enabled: false`: compare diagnostics with observed quota exhaustion for one week.
- [ ] 4.4 Enable `axes.live`; then decide on Radar and enable `axes.daily`, `axes.monthly`.
- [ ] 4.5 Update the deploy playbook: config block, shadow procedure, rollback.
