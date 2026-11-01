# Design: Exact native zero-price evidence

> Current closure: parent accepted final runtime on 2026-11-01 and authorized
> archiving. Earlier runtime-pending and health-choice statements below are
> historical; selected functional contracts remain unchanged.

## Evidence identity and lifetime

`fetchedAt` records when the source snapshot was fetched. It is retained
verbatim for provenance and validated as a finite timestamp that is not in the
future. The fork's private 36-hour expiration is removed because it suppresses
otherwise exact source evidence solely due to elapsed time. This does not
alter upstream strict-zero policy: uncatalogued models still need exact
zero-price evidence, catalogued models still follow their static
`FreeModelBudget` regime, and quota-based catalog entries still require their
existing documented hard stop and safe per-connection quota state.

## Provider mapping

Native models.dev pricing and capability transforms both call `mapProviderId`.
Zero-price extraction must use the same mapping so evidence keys match the
provider identity used by routing. The last raw provider entry mapping to a
canonical provider owns that provider's model set for zero-price evidence;
models absent from that final raw entry are omitted. For an exact model ID in
the final entry, compare its zero-price evidence with the effective native
price returned by `transformModelsDevToPricing`. Do not use embedded model
names/IDs as substitutes.

## Extraction pseudocode

```text
lastProvider = empty canonical provider -> final raw provider entry
for each (rawProviderId, providerData) in models.dev snapshot:
    providers = mapProviderId(rawProviderId)
    for each provider in providers:
        lastProvider[provider] = (rawProviderId, providerData.models)

nativePricing = transformModelsDevToPricing(raw)
result = empty provider -> exact model ID arrays
for each (provider, (rawProviderId, models)) in lastProvider:
    for each (exactModelId, model) in models:
        if rawProviderId is openrouter and
           (exactModelId is free or model.id is openrouter/free):
            continue
        prices = model.cost
        effective = nativePricing[provider][exactModelId]
        if input and output are not numeric zero: continue
        if any reported price is not numeric zero: continue
        if effective is absent or any effective native price is nonzero: continue
        append exactModelId under result[provider]
return result
```

The whole-model-set ownership rule is limited to zero-price evidence source
selection. Effective prices for IDs present in the final provider entry come
from the existing native pricing transform. Thus kilo zero followed by
kilocode nonzero is excluded; kilo nonzero followed by kilocode zero is
eligible; a model present only in the earlier provider set is omitted.

The strict evidence check is:

```text
if evidence missing or dynamic openrouter/free identity: reject
if fetchedAt is invalid or in the future: reject
if exact candidate model is absent under exact candidate provider: reject
otherwise accept source evidence
```

Catalog candidates remain on the existing static FreeModelBudget path; this
change does not shortcut or alter its quota, allowance, connection, or hard
stop decisions.

## Compatible-metadata pricing lifetime

`composeCompatibleMetadataPrices` accepts valid, non-future timestamps without
a maximum age. It still uses only current eligible connections, requires a
complete exact-model price from every eligible connection, and rejects missing
or conflicting input/output values. It retains original timestamps as source
provenance. The age helper only gates pricing composition;
`resolveCompatibleCapabilityOverride` does not call it, so explicit false
vetoes and unknown capability behavior remain unchanged.

## Regression plan

Add a fork-only test file. First run it against current code and capture the
expected failures: stale exact evidence rejected and raw `kilo` evidence stored
under the wrong provider key. Then implement the two narrow changes and rerun.
Cover actual-style zero prices plus `structured_output: true`, exact model IDs,
both alias overwrite directions, an earlier-only model omitted from the final
provider set, old complete compatible zero-price consensus, missing, nonzero,
conflicting, malformed and future compatible pricing, capability false/unknown,
dynamic OpenRouter free exclusion, and static catalog quota/hard-stop behavior.

## Live acceptance boundary

Release acceptance uses the protected GitHub deployment and passive checks of
actual source/image identity, health, native metadata, and candidate admission.
Provider/model inference is explicitly prohibited and is not a required
billing-proof gate. Offline regressions and passive metadata do not establish
actual inference behavior; record that verification limitation without adding
a model-call blocker. Keep unresolved deployment and passive acceptance work
in root `openspec/TODO.md`.
