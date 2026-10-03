## 1. Failing tests first

- [x] 1.1 `bands-filter.test.ts`: in-band, below, above, boundary values, unrated allowed only in `low` with no synthetic score and excluded from `mid`/`high`, tier-derived and static-table scores treated as unrated, inherited Arena score treated as rated, `ratedSources` override, resolver throws → candidate rejected (8 tests pass).
- [x] 1.2 `bands-capabilities.test.ts`: `tools` keeps tool-calling and emulated-tool providers, drops the rest; `so` keeps `true`, drops `false`, drops unknown unless `unknown: allow`; `reasoning` keeps models with `reasoning` or `supportsThinking`, drops the rest; `vision` drops unknown and bridge-forced models; combined capabilities are ANDed; a request without `tools` in the body is still filtered on a `_tools` channel (8 tests pass).
- [x] 1.2a `bands-config.test.ts`: defaults; file override; per-task override; invalid file → defaults and one warning; missing file → defaults (13 focused tests pass, config review clear).
- [x] 1.3 `bands-e2e.test.ts`: band thrifty order is `free`, `keyless`, `subscription`, `cheap`, `premium`; ordinary `auto:thrifty` keeps upstream order; explicit `:free` retains upstream provider/model classification (including `opencode/big-pickle` and `opencode/mimo-v2.5-free`, excluding `openrouter/openai/gpt-4.1` from that predicate); ordered fallback targets contain no out-of-band model (quality E2E 4/4 pass; routing 7/7 and direct upstream resolver/stream/quota 27/27 pass).
- [x] 1.4 Empty band test: no in-band candidate → empty pool, not the full pool (covered by the quality E2E suite).
- [x] 1.5 Flag-off test: same channel resolves to degraded native category; omitted tier remains unset; no quality/capability filter or band rung order is registered; reserve/account narrowing leaves candidate and `allowedConnectionIds` unchanged (flag-off and reserve E2E checks pass).
- [ ] 1.6 `bands-calibrate.test.ts`: traffic on one channel recalculates every task; tertile cut points and overlap; too few rated models keeps previous ranges; thin band keeps previous ranges; boundary shift clamped to `maxShift`; per-task override wins; `mode: "manual"` never changes ranges; state file round-trip; failed run keeps previous ranges; one run for concurrent triggers; no run before `intervalHours`.

## 2. Implementation

- [x] 2.1 `bands/config.ts`: defaults, loader, validation, mtime-based refresh.
- [x] 2.2 `bands/filter.ts`: band predicate on `getTaskFitnessWithSource`.
- [x] 2.2a `bands/capabilities.ts`: `tools`, `so`, `reasoning`, `vision` predicates on `getResolvedModelCapabilities`; combined with the band predicate, capabilities first.
- [x] 2.3 `bands/index.ts`: `parseBandCategory` returns the opaque category when enabled; `buildBandCheck` returns the predicate.
- [ ] 2.4 `bands/calibrate.ts`: observed-model buffer (ids only), per-task fitness resolution and cut points at run time, guards, state file, lazy 24 h trigger.
- [ ] 2.5 `scripts/ad-hoc/bands-calibrate.ts`: per task — rated share by source (`user_override`, `arena_elo`, tier, table, wildcard), score distribution, tertile cut points, model count per band under current config; per capability — known/unknown share and model count per band × capability cell. Report only.
- [ ] 2.6 Run Code Simplifier on the slice.

## 3. Verification

- [x] 3.1 `bands-*` tests and upstream autoCombo tests pass (40 files / 353 tests; core and OpenSSE typechecks pass).
- [x] 3.2 Existing upstream integration changes stay within `suffixComposition.ts`, `virtualFactory.ts`, and the band-scoped selector extension in `resolveAutoStrategy.ts`; ordinary upstream routing remains unchanged.
- [ ] 3.3 Production, flag off: run the calibration script, write the config.
- [ ] 3.4 Production, flag on: `GET /v1/auto-combo/<channel>/candidates` for every channel Hermes will use; none empty.
- [ ] 3.5 Confirm `OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL` is unset in the deploy environment.
- [ ] 3.6 After one week on manual ranges, set `calibration.mode: "auto"`; check the first run's log line and `auto-bands.state.json`.
- [ ] 3.7 Update the deploy playbook: flag, config path, calibration mode, rollback.
