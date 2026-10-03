# OpenSpec TODO

Deferred scope discovered while preparing the Hermes OmniRoute specs.

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
- Production build/start uses the reviewed stock Node 26 image (`package.json` supports `>=24 <27`); Node 24 portability remains a separate baseline, not a production blocker. OpenSpec task 1.4 stays unchecked until the exact reviewed commit passes a clean supported-runtime build/start against an isolated consistent copy.
- Two Node 26 builds of staged commit `db18a17c374506941d10fbc58132eb108d1ea5db` failed. Attempt 1 ran 02:57:04–03:08:36 UTC with a 7 GiB total RAM/swap bound, cpuset 0, and pids limit 512; `npm run build` exited 1 at webpack step 19 and builder inspection reported `OOM=true`. Attempt 2 ran 03:26:10–03:34:11 UTC with the supported 4096 MiB heap argument, the same container/resource bounds, and cached dependencies. It exited 1 after V8 heap exhaustion near 4066 MB and `SIGABRT`; there was no new cgroup OOM event. Logs and diagnostics from both attempts were retained. Neither produced an image or caused production migration/cutover; production remains at `f2bddef27ed0807dd5a5e2712bc26536edda8138`.
- Third diagnostic build for staged `db18a17c374506941d10fbc58132eb108d1ea5db` ran 03:49:15–03:58:53 UTC and exited 1 as `CANCELED` / `context canceled`, not OOM. The watcher expected an exact 9-GiB container value, misclassified an approved 9.5-GiB same-container resource update as a builder replacement, and canceled the build. Logs were retained; this is a watcher guard defect, not an application compatibility issue. Production `f2bddef27ed0807dd5a5e2712bc26536edda8138` and its DB remain untouched; no image was produced.
- Retry 4 for staged `db18a17c374506941d10fbc58132eb108d1ea5db` ran 04:03:26–04:12:29 UTC after preflight reported 27,403,431,936 bytes free disk and 15,284,174,848 bytes `MemAvailable`. The read-only watcher dry run verified the exact container ID, limits, source, and digests. It used the approved 10-GiB total memory-plus-swap limit from startup, heap 6144 MiB, two workers, webpack, cpuset 0, pids 512, and 900 seconds. It exited 1 after a cgroup OOM event at 04:12:22 UTC; the Next worker was SIGKILLed at 535 seconds and builder memory peaked at 9.999/10 GiB. Kernel evidence showed one Node MainThread at 10,220,928 KiB anonymous RSS and 0 file RSS; cgroup memory was 10,665,197,568 bytes anonymous and about 1 MiB file-backed. This indicates anonymous Node memory pressure, with small parent processes rather than multiple heavy workers or file-cache pressure. Host and disk floors remained clear. No image or start result was produced; production remains at `f2bddef27ed0807dd5a5e2712bc26536edda8138`, with no cutover or migration. Before any fifth build, perform read-only local source/config memory diagnosis alongside the retained remote kernel evidence; no fifth build is approved or launched. Keep task 1.4 and production rollout gates open pending diagnosis, operator review, and a successful exact-SHA build/start.
- The earlier isolated-copy migration rehearsal passed the three-row ledger rekey; missing upstream migrations replayed and second init reported 0 pending; FMO data/schema stayed unchanged; trigger rollback checks and SQLite `quick_check` passed. The runbook is [the FMO migration ledger rehearsal](../docs/ops/AUTO_BANDS_MIGRATION_REHEARSAL.md). Production migration is explicitly authorized, but not yet executed; run the rehearsed one-time repair only after exact-commit build/start readiness, using a fresh consistent backup, and verify integrity, idempotence, and rollback. Permanent migration compatibility code remains forbidden.
- Preserve the verified migration-history correction: fork IDs 164–166 are `fmo_pools`, `fmo_pool_decisions`, and `fmo_pool_live_seam`; upstream has `retire_microsoft_designer_web`, `retire_felo_web`, and `retire_gpl_derived_providers` at those IDs. The upstream runner reconciled a rename from 163 to 169 and warned that version-only tracking can skip and rerun a migration. The one-time ledger repair and isolated-copy rehearsal passed on the approved copy and are documented in [the FMO migration ledger runbook](../docs/ops/AUTO_BANDS_MIGRATION_REHEARSAL.md). Production deployment and migration are explicitly user-authorized; execution remains pending readiness gates. Permanent migration mapping/compatibility code is forbidden.
- The billing-rung selector carries exact provider/model/account assignments through the real Auto selector and fallback list. A quota-cutoff-blocked free account could previously outrank routable premium; the band path now keeps blocked accounts after all routable rungs. Review closed both routing findings and confirmed the existing 429 when every candidate is blocked. Routing tests pass 7/7, and direct upstream resolver/stream/quota tests pass 27/27.
- Final local Auto-Combo and service validation passes 41 files / 372 tests, including calibration; core and OpenSSE typechecks pass. Before calibration, the Auto-Combo-only suite passed 40 files / 353 tests. Scoped evidence includes calibration 19/19, quality E2E 4/4, reserve source tests 25/25 across three suites, reserve account-routing E2E 4/4, config 13/13, capabilities 8/8, filter 8/8, routing 7/7, and direct upstream resolver/stream/quota tests 27/27. Independent reviews closed the quality hook, reserve config/capacity/integration, calibration, and both routing findings. ESLint, Prettier, and `git diff --check` pass for the reviewed slices.
- The fork release/deployment guide is documented in `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md` and linked from README and `docs/ops/FLY_IO_DEPLOYMENT_GUIDE.md`; SystemOne environment/API/OpenAPI references are also updated. The production source/container is currently at `f2bddef27ed0807dd5a5e2712bc26536edda8138`; the separate staged deployment target is `db18a17c374506941d10fbc58132eb108d1ea5db`. The target is not live. Verify both SHAs again before cutover. Deployment is authorized and pending resource readiness, supported build/start, and migration execution.
- The user approved nearest-rank calibration over sorted distinct numeric score values from observed rated models: `c1 = scores[ceil(0.33*N)-1]`, `c2 = scores[ceil(0.67*N)-1]`, where `N` is the number of distinct values; for nine different values, use the third and seventh. The rule is written in the quality design/spec. Calibration implementation, report CLI, five independently reviewed fixes, and local tests are complete. The local isolated-DB CLI smoke returned valid JSON for 10 baseline models, 0 rated models, and no cut points; it does not validate the live catalog. Keep the real-catalog report and production calibration run open.
- The enabled band selector now fails closed when a built Auto candidate lacks an exact provider/model/account mapping. `expandPromptCacheAffinityTargetsFromConnections()` can preserve a logical target with `connectionId: null` when the current active-account intersection is empty; dispatch forwards its allowlist and credential selection rechecks it, but a cache-time change could otherwise let dispatch choose an arbitrary account from a multi-account allowlist. The regression covers the null target, and the explicit allowlist remains authoritative over a stale direct pin: retain allowed account B and never route direct account A. The reviewer verified these routing constraints and the quota-cutoff terminal fallback; ordinary upstream routing remains unchanged.
- Correct the quota snapshot API contract in a separate upstream-contract slice. `getQuotaSnapshots()` returns camelCase fields (`connectionId`, `windowKey`, `remainingPercentage`, `nextResetAt`, `createdAt`), with `isExhausted` represented as numeric `0 | 1`; exported `QuotaSnapshotRow` still declares snake_case fields. The reserve slice uses a local strict camelCase boundary and does not add a dual-shape shim. Correct the getter/type declaration later, then remove the local boundary cast only after a runtime-backed contract test passes.
- Calibration implementation and report CLI are complete and locally reviewed. Before enforcement, enable the built-in OmniRoute client for `radar.omniroute.online` in Settings/DB, then separately opt in at `/dashboard/radar` and run **Sync now**. Confirm the public/community catalog status is live with feed version/fetch time and its cache is populated; inspect `GET /api/radar/status` for the other cache states without requiring supporter-only feeds. The latest verified production snapshot had Radar disabled, no endpoint overrides, and empty caches; the local CLI smoke is not a substitute. Public/community catalog access is keyless. The user will enter the supporter Intel key through the dashboard after deployment; this is a post-deploy user action and not a prerequisite for public activation. Bands continue to use Arena/manual rated sources; Radar Intel scores remain separate and are not mapped to `getTaskFitnessWithSource`. After sync, run the report on the real catalog and record rated-source coverage, structured-output capability coverage, and candidate counts for every Hermes channel before enabling enforcement.
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
- Keep `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md` aligned with verified operational evidence. It now documents keyless public Radar activation, the post-deploy dashboard Intel-key step, manual calibration, reserve enablement/rollback, and reviewed test results. Production Radar sync/cache verification, real-catalog calibration, live band routing/log identity, reserve read-only checks, exact-commit Node 26 build/start, migration cutover, and deployment remain open.
- After the remaining implementation and operational gates pass, reconcile stale approval-only wording in `openspec/README.md`, merge the three auto-quality-band deltas (26 distinct requirements) and the SystemOne delta (9 requirements) into the living specs, validate strictly, then archive the four OpenSpec packages. Keep all packages open until those gates pass.
- After band behavior and role mapping are validated, migrate Hermes `fmo-grid-*` profiles to the selected `auto/<task>_<band>[_<cap>...][:<tier>]` channels.
