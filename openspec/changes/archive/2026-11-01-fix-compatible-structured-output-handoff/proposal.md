# Fix compatible structured-output handoff

> Current closure: parent accepted final runtime on 2026-11-01 and authorized
> archiving. Earlier runtime-pending and health-choice statements below are
> historical; selected functional contracts remain unchanged.

## Why

OmniRoute already exports a declared structured-output boolean as
`capabilities.structured_output`. The compatible metadata importer, per-connection
snapshot, synced model row, and capability resolver do not carry this value as one
contract. A declared `true` or `false` can therefore disappear before resolution.

The existing compatible resolver already has the needed policy: exact provider,
connection, and raw model identity; current active-connection eligibility; explicit
`false` veto; declared `true` otherwise; absent data stays unknown. This change
extends that contract to structured output.

## What changes

- Normalize only native `capabilities.structured_output` booleans into compatible
  metadata, preserving `true`, `false`, and absence through snapshots and synced
  rows.
- Hand the compatible declaration to `getResolvedModelCapabilities` through the
  existing exact-identity reducer, preserving higher-priority synced booleans.
- Add offline regressions that pass records from the real OmniRoute catalog exporter
  through import, persistence, and resolution.

No alias fields, model-name inference, per-model overrides, provider inheritance,
free/base crossing, or unknown-policy changes are introduced. APInex capability
coverage remains source-dependent; no capability is inferred from prior request
success.

## Impact

- Source: `compatibleMetadata.ts`, `modelDiscovery.ts`, `synced.ts`, and
  `modelCapabilities.ts`.
- Tests: compatible metadata import and capability resolution.
- Specification: `compatible-model-metadata`.
- Operational acceptance remains a separate post-deployment gate recorded in
  `openspec/TODO.md`.
