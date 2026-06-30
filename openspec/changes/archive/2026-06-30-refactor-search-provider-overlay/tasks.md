- [x] Add OpenSpec delta for overlay-backed search provider routing.
- [x] Add failing registry/catalog/handler tests proving Hermes providers work from overlay
      while upstream registry excludes fork provider IDs.
- [x] Add fork-owned overlay registry and update `/v1/search`, catalog, stats, analytics,
      schema, and internal search execution to import it.
- [x] Extend `handleSearch` options to accept resolved primary and alternate
      `SearchProviderConfig`.
- [x] Remove Hermes provider configs, credential fallback entries, and auto-order entries
      from upstream `open-sse/config/searchRegistry.ts`.
- [x] Run targeted search tests.
- [x] Update `openspec/TODO.md`, archive change into living spec, and record review notes.
