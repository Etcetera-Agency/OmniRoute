# Proposal: Add Hermes Search Routing Support

## Why

Hermes uses OmniRoute as its search gateway through `/v1/search` or the OmniRoute MCP search tool. Current `/api/v1/search` auto-selection sorts providers by cost when no explicit provider is supplied. Hermes needs a configurable provider priority chain and health-aware fallback without implementing a separate Hermes search plugin.

**Context**:

- `/api/v1/search/route.ts` exists and delegates search work to `open-sse/handlers/search.ts`.
- `open-sse/config/searchRegistry.ts` defines search providers.
- `src/app/api/search/providers/route.ts` exposes provider catalog/status for dashboard tooling.
- Hermes daily model-manager belongs in Hermes, but it needs OmniRoute to honor configured search order at runtime.

**Current state**: Search provider selection is internal to OmniRoute and prefers cheapest configured providers for automatic selection.

**Desired state**: OmniRoute supports a configured search provider order over providers present in `open-sse/config/searchRegistry.ts` and uses runtime health/cooldown/credential state to skip unavailable providers.

## What Changes

- Add a configured search routing order consumed by `/v1/search` when request body has no explicit `provider`.
- Preserve explicit provider behavior: explicit `provider` selects only that provider. Search routing fallback applies only to automatic provider selection when `provider` is omitted.
- Keep runtime fallback, cooldown, and credential health inside OmniRoute.
- Expose provider order/status through the provider catalog route so Hermes can observe current routing state.
- Add tests for configured order, explicit provider behavior, cooldown skip, and credential failure fallback.

## Impact

### Affected Specifications

- `openspec/specs/search-routing/spec.md` - Adds configurable ordered search fallback.

### Affected Code

- `src/app/api/v1/search/route.ts` - Auto provider selection and fallback order.
- `src/lib/search/searchChain.ts` - Provider chain construction, health skip, fallback execution, and error classification.
- `open-sse/config/searchRegistry.ts` - Provider metadata and configured order support.
- `src/app/api/search/providers/route.ts` - Expose provider order/status.
- `src/shared/schemas/searchTools.ts` - Catalog response schema includes search routing order/status.
- Tests under `tests/unit` and/or `tests/integration`.

### User Impact

- Hermes can call `/v1/search` without owning provider fallback logic.
- Search provider order becomes predictable and inspectable.
- Temporary provider failures do not require Hermes-side retry code.

### API Changes

- No breaking change to `/v1/search`.
- Auto-selection behavior changes from cheapest-first to configured priority-first.
- Configured search order is observable and used for automatic routing.

### Migration Required

- [ ] Database migration
- [ ] API version bump
- [ ] User communication needed
- [x] Documentation updates

## Timeline Estimate

Medium. Mostly search routing, adapter wiring, and tests.

## Risks

- Search costs may rise if configured priority chooses a non-cheapest provider. Mitigate by making order explicit and visible.
- Existing callers may expect cheapest-first auto-selection. Mitigate with documented config and unchanged explicit-provider behavior.
