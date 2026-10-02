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
- Complete OpenSpec task 1.4: finish the unmodified upstream Node 24 build/start smoke at `23a11484862b3bb589a55e85b00e4ac53ffeb234` against the isolated production-database snapshot. The isolated-copy rehearsal passed the three-row ledger rekey; missing upstream migrations were replayed, and a second init reported 0 pending; FMO data/schema stayed unchanged; trigger/savepoint rollback checks and SQLite `quick_check` passed. It used a fresh read-only snapshot under a task-owned temporary directory; production was neither modified nor restarted. The rehearsal procedure and results are documented in [the FMO migration ledger runbook](../docs/ops/AUTO_BANDS_MIGRATION_REHEARSAL.md). The optimized Next build remains incomplete. One earlier local attempt stopped near 1.4 GB free disk; a later preflight began at 19 GiB free with a 14 GiB guard and ended at 19,480,548 KiB after both init passes. Its `--rm` container metadata is gone, and the exact-container Docker journal query returned no records, so the failure cause is unrecoverable. Do not retry or take production action from this checkpoint. Keep task/container logs for any future build/start gate. Production files/data were untouched.
- Before deployment, preserve the verified migration-history correction: fork IDs 164–166 are `fmo_pools`, `fmo_pool_decisions`, and `fmo_pool_live_seam`; upstream has `retire_microsoft_designer_web`, `retire_felo_web`, and `retire_gpl_derived_providers` at those IDs. The upstream runner reconciled a rename from 163 to 169 and warned that version-only tracking can skip and rerun a migration. The one-time ledger repair and isolated-copy rehearsal passed on the approved copy only and are documented in [the FMO migration ledger runbook](../docs/ops/AUTO_BANDS_MIGRATION_REHEARSAL.md). Production changes remain unauthorized, and permanent migration mapping/compatibility code is forbidden.
- The billing-rung selector carries exact provider/model/account assignments through the real Auto selector and fallback list. A quota-cutoff-blocked free account could previously outrank routable premium; the band path now keeps blocked accounts after all routable rungs. Review closed both routing findings and confirmed the existing 429 when every candidate is blocked. Routing tests pass 7/7, and direct upstream resolver/stream/quota tests pass 27/27.
- Other scoped evidence: quality E2E 4/4, config 13/13, capabilities 8/8, filter 8/8, and five focused band suites 37/37 before reserve-config extension. The quality owner reported 201/201 across 28 files before WIP reserve tests. A later partial run passed 208 tests, but could not import the in-progress reserve module. The reserve module/tests are excluded from the first commit; these counts do not certify reserve. ESLint and Prettier pass on the changed routing source and regression test; the last reported typecheck had zero diagnostics.
- The fork release/deployment guide is now documented in `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md` and linked from README and `docs/ops/FLY_IO_DEPLOYMENT_GUIDE.md`. Its latest link check passed (169 docs, 1175 links). Before deployment, still resolve the external deployment reference in `/Users/theDay/.ssh/config.md`: `/opt/apps/omniroute/source` was missing and only timestamped source backups were found.
- Calibration remains blocked on a decision about calculating the 33rd/67th percentile cut points (nearest-rank versus interpolation). The user has been asked to choose; do not calculate or encode a method until they answer.
- The enabled band selector now fails closed when a built Auto candidate lacks an exact provider/model/account mapping. `expandPromptCacheAffinityTargetsFromConnections()` can preserve a logical target with `connectionId: null` when the current active-account intersection is empty; dispatch forwards its allowlist and credential selection rechecks it, but a cache-time change could otherwise let dispatch choose an arbitrary account from a multi-account allowlist. The regression covers the null target, and the explicit allowlist remains authoritative over a stale direct pin: retain allowed account B and never route direct account A. The reviewer verified these routing constraints and the quota-cutoff terminal fallback; ordinary upstream routing remains unchanged.
- Correct the quota snapshot API contract in a separate upstream-contract slice. `getQuotaSnapshots()` returns camelCase fields (`connectionId`, `windowKey`, `remainingPercentage`, `nextResetAt`, `createdAt`), with `isExhausted` represented as numeric `0 | 1`; exported `QuotaSnapshotRow` still declares snake_case fields. The reserve slice uses a local strict camelCase boundary and does not add a dual-shape shim. Correct the getter/type declaration later, then remove the local boundary cast only after a runtime-backed contract test passes.
- Run the calibration report against the production pool; record rated-source coverage, structured-output capability coverage, and candidate counts for every Hermes channel before enabling enforcement.
- Confirm `OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL` is unset and band candidate pools remain non-empty with enforcement enabled.
- Before enabling demand reserve, compare usage provider/model IDs with catalog IDs and measure the 24-hour, 7-day, and 30-day aggregate reads on production data.
- Reserve scope policy needs source-contract tracing before a user decision: the initial 1B/500M example came from a UI test, and production accounts with different limits in one pool have not been confirmed. The reserve writer is tracing authoritative `shared_pool.tokensPerMonth` versus per-model `monthlyTokens`; do not choose policy until that trace is complete and the user clarifies scope. The user resolved disabled-reserve behavior to a full stop for calculations, refresh, and diagnostics; update the spec and add a regression for it. Do not mark demand/capacity complete or final until both items are resolved and verified. Do not encode alternatives in OpenSpec deltas.
- After the reserve scope and controller are complete, validate the enabled reserve in shadow mode against observed quota exhaustion before enabling capacity axes; confirm refresh diagnostics and read-only behavior. The disabled state remains a full stop with no calculations, refresh, or diagnostics.
- Review the proposed 7-day reserve lookback against weekly Hermes schedules after the production shadow run; retain the approved timeframe until evidence supports a separately approved change.
- Consider a separate proposal for a self-hosted Radar limits feed (`RADAR_FEED_URL`, `RADAR_FEED_PUBKEY`) if OmniRoute needs its own measured capacity data.

## Decisions and remaining work for `add-systemone-decisions-route`

- The user approved and froze this separate package on 2026-10-03: 23 tasks, 9
  requirements, 27 scenarios; OpenSpec validation passed. Runtime implementation
  has started in its separately owned modules.
- Keep these follow-ups visible: verify the live OpenRouter response shape;
  validate Laya-only behavior for RU/UK and fallback after Laya stops; collect a
  representative latency sample; verify production flag-off, deployment
  variables and rollback, and error-row monitoring. Laya deployment and the
  Hermes caller switch are outside OmniRoute's repository scope.

Deferred cross-repository and operations work:

- Extend `docs/ops/FORK_RELEASE_AND_DEPLOYMENT.md` with band flags/configuration, calibration, reserve rollout, and rollback details before production rollout; the initial upstream rebase/tag procedure is complete.
- After band behavior and role mapping are validated, migrate Hermes `fmo-grid-*` profiles to the selected `auto/<task>_<band>[_<cap>...][:<tier>]` channels.
