# Proposal: Add Routing Config UI

## Why

`add-hermes-search-routing-support` and `add-mdream-web-fetch-fallback` give
OmniRoute configured provider chains for the two gateway endpoints, but the
order and default-fallback behavior are config/env-driven and only exposed
read-only. An operator can enter provider API keys through the existing
Providers UI, but cannot reorder the priority chain, disable a provider from
automatic routing, or flip the default fallback behavior from the dashboard.
Hermes operators need to manage routing for **both** chains without editing
code or env files:

- **Main chain** — search provider order for `/v1/search` (`kind: "search"`).
- **Additional chain** — web-fetch provider order for `/v1/web/fetch` (`kind: "fetch"`).

**Context**:
- `src/app/(dashboard)/dashboard/search-tools/components/SearchToolsConfigPane.tsx` already splits providers by `kind === "search"` vs `kind === "fetch"`.
- `src/app/api/search/providers/route.ts` exposes a GET-only catalog/status route.
- `src/lib/db/settings.ts` provides the settings persistence pattern used by other operator-tunable config.
- The default orders are owned by `add-hermes-search-routing-support` (search) and the living `web-fetch-routing` spec (web-fetch; the `add-mdream-web-fetch-fallback` change is already implemented and archived).

**Current state**: Provider order and default fallback are fixed in config; the dashboard can show status but not edit routing.

**Desired state**: An operator can reorder, enable/disable, and set default fallback per endpoint from the dashboard; the routing read paths honor the persisted overrides and fall back to the built-in default order when no override exists.

## What Changes

- Persist a per-endpoint routing override (ordered provider list, per-provider enabled flag, default-fallback flag) for `search` and `fetch` chains via the existing settings store.
- Add a write endpoint to read and update routing overrides with management auth.
- Make the search routing read path (`add-hermes-search-routing-support`) and the web-fetch routing read path (`add-mdream-web-fetch-fallback`) consume the persisted override, defaulting to the built-in order when unset.
- Add dashboard UI in the existing search-tools config pane to reorder providers, toggle each provider on/off for automatic routing, and set the default fallback per endpoint, for both the search (main) and fetch (additional) chains.
- Disabling a provider for automatic routing MUST NOT delete its credentials and MUST still allow explicit `provider:` selection.
- Add tests for persistence, read-path override precedence, default reset, management auth, and UI wiring.

## Impact

### Affected Specifications
- `openspec/specs/routing-config-ui/spec.md` - Adds operator-editable routing order and fallback config for both endpoints.

### Affected Code
- `src/lib/db/settings.ts` - Persist routing overrides (add a migration only if a new key/table is required).
- `src/app/api/search/providers/route.ts` - Add a write path (e.g. `PUT`) for routing overrides; keep GET catalog/status.
- `open-sse/handlers/search.ts` / `src/app/api/v1/search/route.ts` - Read persisted search order/enabled/default-fallback (override of the built-in order).
- `open-sse/handlers/webFetch.ts` / `src/app/api/v1/web/fetch/route.ts` - Read persisted web-fetch order/enabled/default-fallback.
- `src/app/(dashboard)/dashboard/search-tools/components/SearchToolsConfigPane.tsx` - Reorder / toggle / default-fallback controls for both chains.
- `src/shared/schemas/searchTools.ts` - Override request/response schema.
- Tests under `tests/unit`, `tests/integration`, and `tests/e2e/search-tools-studio.spec.ts`.

### User Impact
- Operators manage search and web-fetch routing from the dashboard, no env edits.
- Provider order and default fallback become inspectable and editable.
- Disabling a provider for automatic routing is reversible and non-destructive.

### API Changes
- `GET /api/search/providers` unchanged (still catalog/status).
- New write path accepts a routing override for `search` and `fetch` endpoints.
- `/v1/search` and `/v1/web/fetch` automatic routing honor persisted overrides.

### Migration Required
- [ ] Database migration (only if routing overrides need a dedicated table rather than the existing settings store)
- [ ] API version bump
- [ ] User communication needed
- [x] Documentation updates

## Timeline Estimate

Medium. Persistence + two read-path reads + one write endpoint + dashboard controls + tests.

## Risks

- Override drift vs built-in defaults: mitigate by always falling back to the built-in order for providers missing from the override and validating override provider IDs against the registry.
- Operator disables every provider: mitigate by validating that at least one compatible provider remains enabled, or by treating an all-disabled chain as "use built-in default".
- Coupling to two routing slices: this change depends on both routing slices landing first; gate read-path edits behind their presence.
