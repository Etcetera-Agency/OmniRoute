# Design: exact free-prefix canonical identity binding

## Boundary

The native candidate keeps its provider ID and raw `free/...` model ID for
dispatch. A single strict identity lookup supplies an exact catalog base to the
existing capability and task-fitness resolvers. It does not create a new
provider, route alias, capability row, score row, pricing row, or candidate.

The only accepted input form is a model ID beginning with the literal
`free/`. Its entire remainder is looked up as an exact provider-registry model
ID. The helper does not remove a second slash segment, normalize case, follow
aliases, or match prefixes. An absent exact result returns no binding.

## Capability resolution

`getResolvedModelCapabilities` first performs its current provider-scoped
resolution with the raw provider/model pair: exact synced capability, exact
provider registry record, model-specific override, custom vision override,
and current static resolution keep their existing order. For `free/` IDs,
synced capability lookup uses the exact raw model ID; it does not strip the
path to a leaf. When the model has a strict exact `free/` binding, missing
synced, registry, and static capability fields may be filled from the
canonical base:

1. Read synced capability rows for the exact raw ID, then the exact base only
   when the base has an exact provider-registry anchor. Keep direct raw-ID
   fields ahead of base fields; `null` and omitted values are gaps.
2. Read every provider-registry row whose `id` exactly equals the base.
3. For each registry field already consumed by the resolver, ignore omitted values and
   keep the value only when all declared values agree. Explicit conflicts
   produce no canonical value for that field. Provider transport fields such
   as `targetFormat`, `unsupportedParams`, timeout, and price never cross the
   identity boundary.
4. Look up a static model spec only when the exact/alias index returns the
   same string as the base; this excludes aliases and prefix matches.
5. Fill only fields still absent from direct provider-scoped resolution.
   Existing boolean `false`, vision overrides, and synced model rows keep their
   current precedence.

The existing effort-suffix fallback is skipped for `free/` paths. The full
remainder is the identity under test, so an unanchored `free/<base>-high` does
not inherit from a separately known `<base>` model.
The last-resort vision-family heuristic is also skipped only for unanchored
free paths; exact provider-scoped synced rows and operator overrides still run
before that heuristic boundary.

The returned `provider`, `model`, and `rawModel` stay those produced by the
existing input resolver. This lets native capability checks reuse established
evidence without changing the request's route ID.

The native candidate builder continues to use that raw ID for provider-scoped
hidden-model keys, synchronized-model membership, per-connection exclusions,
and the candidate's dispatch fields. Metadata inheritance does not rewrite
those keys. A hidden key for `(provider, free/<base>)` hides that candidate; a
hidden key for `(provider, <base>)` does not. Connection exclusions continue
to match the full raw path or its final path segment and only narrow the
candidate's existing `allowedConnectionIds`.

## Fitness resolution

`resolveScoresAs` handles a leading `free/` before generic relation and
suffix logic. If the exact base exists, return that base with provenance
`free-prefix`; if it does not, return the input unresolved immediately. This
early return prevents the current generic `findRegistryScoresAs` basename
behavior from turning an unknown path into a guessed model.

`getTaskFitnessWithSource` already checks direct provider/model-ID rows before
calling `lookupInheritedFitness`. That inherited lookup already preserves
user override and Arena priority, selected profile/global benchmark precedence,
retirement/expiry gates, and `:inherited` source tags. Only the identity result
changes. Fitness formulas, score values, and the band filter remain untouched.

## Pseudocode

```text
resolveFreePrefixBase(modelId):
  if modelId does not start with exact "free/":
    return none
  base = modelId after the first "free/"
  if base is empty or no registry row has id exactly equal to base:
    return none
  return base

resolveScoresAs(modelId):
  if modelId starts with exact "free/":
    base = resolveFreePrefixBase(modelId)
    return { base, via: "free-prefix" } if base exists
    return { base: modelId, via: null }
  return existing explicit, effort-suffix, and -free-suffix logic unchanged

resolveCapabilities(provider, rawModel):
  resolved = existing provider/model resolver(provider, rawModel)
  direct = existing exact provider-scoped capability sources(resolved)
  if resolved.model starts with "free/":
    direct.synced = synced rows for exact raw model ID only
    skip generic effort-suffix fallback
    skip model-name vision heuristic unless exact base exists
  base = resolveFreePrefixBase(resolved.model)
  if base exists:
    direct.synced = direct.synced with missing fields filled from exact base-ID rows
    sharedRows = registry rows where row.id === base
    shared[field] = unanimous declared value for that field, else unknown
    exactSpec = static spec only when exact canonical lookup(base) === base
    direct.registry/static[field] = direct[field] ?? shared[field] ?? exactSpec[field]
  return existing capability result with resolved raw IDs
```

## Focused regressions

- RED against the pre-change resolver: exact APInex raw `free/muse-spark-1.3`
  remains unresolved for `scoresAs`, and the native capability consumer has no
  exact provider source for the base identity.
- GREEN with the exact ID: canonical tool, vision, and reasoning fields are
  available; conflicting output limits remain unknown; provider-specific
  `false` and vision overrides still win.
- `free/unknown`, prefix-only `free/muse-spark-1`, and a free ID whose only
  candidate is a nested provider path stay unbound. An exact `kimi` registry
  ID still binds even though longer Kimi IDs share that prefix.
- Seeded expired Arena evidence on a canonical base remains expired when
  queried through its free-prefixed raw ID.
- Compare existing base and inherited free-prefixed `coding`/`general` and
  low/medium/high results. Native band regression keeps the raw route ID and
  supplied pool membership; no non-band pool is widened. An AutoCombo
  preparation regression also proves an exact raw hidden key still excludes
  the candidate, a base-only hidden key does not get rewritten to the raw key,
  and raw/base connection exclusions still narrow only the existing account
  allowlist after canonical capabilities are attached.
