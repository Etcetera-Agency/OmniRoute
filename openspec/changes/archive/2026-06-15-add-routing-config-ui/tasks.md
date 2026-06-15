# Implementation Tasks

## Phase 1: Persistence

- [x] 1.1 Define the `RoutingOverride` shape (`endpoint`, `order`, `disabled`, `updatedAt`) and add load/save helpers via the existing settings store (`src/lib/db/settings.ts`); add a migration only if the settings store cannot hold the record.
- [x] 1.2 Add Zod schema for the routing override in `src/shared/schemas/searchTools.ts`, validating provider IDs against the endpoint registry and rejecting wrong-`kind` entries.

## Phase 2: API

- [x] 2.1 Add a management-auth write path (e.g. `PUT`) to `src/app/api/search/providers/route.ts` for both `search` and `fetch` endpoints; keep `GET` as catalog/status.
- [x] 2.2 Return the normalized effective config from the write path so the UI re-renders immediately.
- [x] 2.3 Reject unknown/wrong-kind provider IDs and unauthorized writes; route errors through `buildErrorBody()`.

## Phase 3: Read-Path Integration

- [x] 3.1 Make the search routing read path (`add-hermes-search-routing-support`) resolve the effective order from the persisted override, appending registry providers missing from the override and excluding disabled ones; fall back to the built-in default order when no override exists.
- [x] 3.2 Make the web-fetch routing read path (per the living `web-fetch-routing` spec) resolve the effective order the same way for the fetch chain.
- [x] 3.3 Ensure disabling affects only automatic routing — explicit `provider:` selection still executes a disabled provider.

## Phase 4: Dashboard UI

- [x] 4.1 Extend `SearchToolsConfigPane.tsx` with reorder controls over the active endpoint's providers, reusing the existing `kind === "search"` / `kind === "fetch"` split (main and additional chains).
- [x] 4.2 Add per-provider enable/disable toggle (disabled = excluded from auto routing, credentials kept).
- [x] 4.3 Add a "Reset to default order" action.
- [x] 4.4 Keep missing-credential providers visible but prevent saving them as enabled-but-unusable.

## Phase 5: Quality

- [x] 5.1 Add unit tests for override persistence and effective-order precedence (including appended new providers and disabled exclusion).
- [x] 5.2 Add route tests for management-auth, unknown/wrong-kind provider rejection, and reset.
- [x] 5.3 Add read-path tests proving disabled providers are skipped in auto routing but callable explicitly, for both `/v1/search` and `/v1/web/fetch`.
- [x] 5.4 Add e2e coverage in `tests/e2e/search-tools-studio.spec.ts` for reorder, toggle, and reset.
- [x] 5.5 Run `npm run typecheck:core`, targeted search/web-fetch tests, and `npm run lint`.
