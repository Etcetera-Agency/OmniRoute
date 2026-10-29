# Change: Bind exact APInex free model identities

## Problem

APInex custom-provider nodes expose provider-dispatch IDs such as
`free/muse-spark-1.3`. OmniRoute already has capability and fitness evidence
for the exact canonical ID `muse-spark-1.3`, but the capability resolver sees
the provider-scoped raw ID and the fitness resolver cannot bind its leading
`free/` namespace. Native capability filters therefore miss reusable exact-ID
evidence, and task fitness can fall through to a wildcard instead of an
eligible canonical score.

The APInex ID remains the runtime route key. This change binds only evidence
lookups to an existing exact catalog identity.

## Chosen behavior

- Parse only a leading literal `free/` and bind its remainder only when that
  complete string is an exact provider-registry model ID.
- Keep unknown and partial IDs unresolved. Do not strip arbitrary path
  segments, apply model aliases, use prefix matching, or use unanchored model
  name heuristics for shared capability evidence.
- Resolve capability fields from exact canonical synced/registry/spec evidence
  after the existing provider-scoped sources. Synced model keys must exactly
  equal the raw ID or an anchored canonical base; never resolve a leaf from an
  unbound free path. Merge duplicate exact-ID registry rows field by field: a
  field is reusable only when all rows that declare it agree; conflicts remain
  unknown.
- Keep direct provider-scoped synchronized capabilities and operator
  overrides ahead of shared canonical evidence. Explicit `false` values keep
  the precedence assigned to their source by the existing resolver.
- Reuse the existing `resolveScoresAs` inheritance path for user overrides,
  Arena ELO, global benchmark fitness, selected profile fitness, and the
  existing models.dev tier source. Preserve its source priority, expiry checks,
  and returned `:inherited` provenance.
- Return and dispatch the original `free/...` model ID. Do not add or remove
  candidate-pool entries.

## Out of scope

- APInex free entitlement, pricing, quota, rate-limit, and zero-cost catalog
  ingestion. Those require the separate source-backed catalog work tracked in
  `openspec/TODO.md`.
- Any changes to fitness formulas, evidence normalization, score expiry,
  source priority, profile selection, band membership, Auto filters, routing,
  or cost guards.
- Aliases, fuzzy matching, provider-route prefix guessing, model-pool
  expansion, and dispatch-ID rewriting.

## Affected areas

- `open-sse/config/providerModels.ts`: exact duplicate registry rows and the
  strict leading-`free/` identity anchor.
- `src/lib/modelCapabilities.ts`: exact canonical capability fallback beneath
  direct provider-scoped capability sources.
- `open-sse/services/autoCombo/scoresAs.ts`: strict `free/<canonical-id>`
  score identity mapping consumed by the existing task-fitness resolver.
- Focused capability, fitness, and native band regressions.

## Acceptance

- A real raw ID `free/muse-spark-1.3` binds to exact catalog ID
  `muse-spark-1.3` for capability and fitness lookup while its provider and raw
  model fields remain unchanged.
- Duplicate registry rows contribute a capability only when their declared
  values agree; provider-specific explicit values retain precedence.
- Unknown, partial, ambiguous-by-prefix, and expired score cases do not gain a
  canonical score.
- Existing base/profile `coding` and `general` results remain unchanged, and a
  free-prefixed candidate does not broaden the native pool or alter band
  predicates.
