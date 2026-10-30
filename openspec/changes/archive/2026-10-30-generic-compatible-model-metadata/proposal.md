# Change: Shared compatible model metadata

## Why

Compatible model discovery currently has separate protocol branches, but pricing
evidence is collected through a provider-branded path. That makes metadata,
prices, refresh behavior, and node selection drift apart. The owner selected one
provider-agnostic adapter for stored node types `openai-compatible` and
`anthropic-compatible`, using the existing protocol handlers and model
discovery persistence.

## What Changes

- Normalize metadata from both real compatible node types into the existing
  synced-model shape while retaining exact raw model IDs and explicit false
  capability values.
- Reuse the existing `modelsPath` setting for both types. Keep relative-path
  behavior and defaults; also accept an explicit absolute model endpoint only
  when it has the same origin as the configured base URL.
- Follow complete Anthropic-style cursor pagination. Incomplete or invalid
  pagination is a failed refresh and cannot replace the last valid snapshot.
- Persist one current source snapshot per exact provider and connection with
  source URL, local fetch time, normalized metadata, exact IDs, and only
  explicitly unit-bearing prices.
- Feed fresh, unambiguous compatible prices into the existing pricing and
  strict-zero evidence paths. Keep provider, connection, and raw model identity
  exact; omit missing, malformed, stale, future-dated, conflicting, or
  cross-connection ambiguous prices.
- Refresh active compatible nodes through the normal model sync lifecycle;
  failures remain independent of models.dev pricing and capability sync.
- Remove the former provider-branded collector and storage namespace. Preserve
  the existing strict-zero filter, benchmark formula, route identity, hidden
  state, and per-connection exclusions.
- Mark the earlier provider-specific proposals superseded by this owner
  decision while retaining their historical completion receipts.
- Keep the shared compatible discovery import graph below validation and
  provider-runtime modules so the emitted benchmark operator can load it without
  a new cyclic module path.
- Break the emitted `contextManager`/`comboContextLimit` initializer cycle by
  removing the reverse import edge while keeping context-limit calculation and
  routing behavior unchanged.

## Impact

- Affected behavior: compatible model discovery, metadata normalization,
  current pricing evidence, and existing models.dev refresh integration.
- Affected files: provider model discovery routes and validation helpers,
  `modelDiscovery`, models.dev sync/persistence, focused tests, OpenSpec, root
  `completion.review`, and `openspec/TODO.md`.
- No new node type, external provider request during development, network
  credential use, history/raw archive, price inference, model search, routing
  change, or runtime mutation is included.
- Local application/image builds and transpilation remain out of scope. A
  reviewed local commit is the delivery boundary; GitHub build/release and live
  acceptance remain separate gates.
