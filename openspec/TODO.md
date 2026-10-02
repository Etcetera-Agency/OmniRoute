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

Before implementing and enabling the approved packages in `openspec/changes/`:

- Verify `auto/coding_high` and `auto/coding_high:free` pass chat reasoning routing unchanged, and confirm usage records retain the full requested band channel in `call_logs.combo_name`.
- Verify omitted tier defaults to `thrifty` only for band channels, while plain upstream channels retain their existing tier resolution and plain `auto:thrifty` candidate order.
- Verify switching `OMNIROUTE_AUTO_BANDS` off after it has been enabled bypasses quality/capability filters, rung ordering, and reserve narrowing, and leaves every candidate's `allowedConnectionIds` unchanged.
- Verify band `thrifty` candidates are ordered `free → keyless → subscription → cheap → premium`, without the ordering itself excluding a candidate for quality or economic class; preserve the confirmed upstream `:free` provider/model behavior for eligible keyless OpenCode models.
- If a future Hermes role requires a per-connection zero-spend guarantee, define that as separate scope: current `:free` classification is provider/model-level and does not distinguish an optional API-key OpenCode connection from its no-auth connection.
- Verify the `virtualFactory.ts` account hook removes reserved connection IDs from `allowedConnectionIds` before rung ordering and dispatch, keeps a candidate while at least one account remains, and removes it when none remain.
- Confirm the only pre-existing upstream integration files in the branch diff are `suffixComposition.ts` and `virtualFactory.ts`; ordinary upstream routes remain unchanged.
- Start the unmodified upstream build on a copy of the production database and record migration behavior, including the fork/upstream migration-number overlap.
- Run the calibration report against the production pool; record rated-source coverage, structured-output capability coverage, and candidate counts for every Hermes channel before enabling enforcement.
- Confirm `OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL` is unset and band candidate pools remain non-empty with enforcement enabled.
- Before enabling demand reserve, compare usage provider/model IDs with catalog IDs and measure the 24-hour, 7-day, and 30-day aggregate reads on production data.
- Run reserve in shadow mode against observed quota exhaustion before enabling capacity axes; confirm refresh diagnostics and read-only behavior.
- Review the proposed 7-day reserve lookback against weekly Hermes schedules after the production shadow run; retain the approved timeframe until evidence supports a separately approved change.
- Consider a separate proposal for a self-hosted Radar limits feed (`RADAR_FEED_URL`, `RADAR_FEED_PUBKEY`) if OmniRoute needs its own measured capacity data.

Deferred cross-repository and operations work:

- Update the OmniRoute deploy playbook with upstream rebase/tag procedure, band flags and config, calibration, reserve rollout, and rollback.
- After band behavior and role mapping are validated, migrate Hermes `fmo-grid-*` profiles to the selected `auto/<task>_<band>[_<cap>...][:<tier>]` channels.
