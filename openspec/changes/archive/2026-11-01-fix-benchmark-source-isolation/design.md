# Design: Isolate benchmark source refreshes

> Current closure: parent accepted final runtime on 2026-11-01 and authorized
> archiving. Earlier runtime-pending and health-choice statements below are
> historical; selected functional contracts remain unchanged.

## Source discovery

The per-model direct checks remain authoritative evidence. Keep existing
positive direct-score and usable-found early returns. If no usable positive
evidence exists, preserve the exact active-catalog ID check, then run the
existing Hugging Face search. A usable Hugging Face result ends discovery for
that model. Only an unusable or failed Hugging Face result permits the existing
Ollama Search path. Direct errors and incomplete results remain errors and
incomplete in the receipt; they are not rewritten as misses.

    if direct evidence already gives usable positive fitness:
        return existing positive-evidence outcome
    if direct exact checks already found usable evidence:
        return existing found-evidence outcome
    if model ID is not an exact active catalog ID:
        return without discovery

    hf = await findHuggingFaceEvidence(model)
    record hf receipt
    if hf contains usable evidence:
        replace only successful nonempty hf dataset
        return without web search

    web = await existing Ollama Search(model)
    record web receipt
    continue with the existing normalizer only for supplied search results

An empty or failed source never becomes a claim that the benchmark is absent.
Direct failed rows remain in storage until that same source completes a
nonempty refresh.

## Direct snapshot publication

Source success is evaluated independently. A dataset is replaceable only when
its own source status is found and its complete parsed row set is nonempty.
Build source replacements only for those datasets. For each replaceable source,
include every catalog model: a model with no matches gets an empty row list so a
successful current set can remove stale rows for that model/source. A failed,
incomplete, or source-level empty dataset contributes no replacement pair.

    successfulSources = sources where status is found and allRows is nonempty
    if successfulSources is empty:
        return receipts with no evidence write and no fitness publication

    replacements = []
    for source in successfulSources:
        for model in currentCatalog:
            matches = current rows for (model, source)
            replacements.push((model, source, matches))

    partial = successfulSources.count != configuredSources.count
    if not partial:
        append global obsolete-ID cleanup pairs

    transaction:
        upsert current catalog identities
        replaceModelBenchmarkEvidenceSources(replacements, afterReplace):
            afterReplace publishes fitness snapshot
        update model processing receipts
    after transaction commits:
        invalidate fitness cache

The replacement batch and publisher callback use the existing database API.
The outer transaction keeps identity writes, evidence replacement, fitness
publication, and receipts atomic. Any publisher error rolls all database writes
back. Cache invalidation runs only after a successful commit. Source-level
partial status is retained in each receipt; source errors are never reported as
complete. A fully successful refresh keeps the existing global obsolete-ID
cleanup behavior.

## Normalized response validation

Envelope validation remains strict: require a choice, finish_reason equal to
stop, string content, valid JSON, and a results array. Envelope failures return
an invalid-response reason and never produce replacement rows.

For each results item, run the existing checks independently and preserve the
same validation conditions:

- fields have expected types and required populated values;
- model ID and name exactly match the requested catalog identity;
- source URL exactly matches one supplied search result;
- quote is nonempty and occurs literally in that result's title or snippet;
- quote includes model, benchmark, version, metric, effort, config, and date;
- numeric values are finite and present literally in the quote.

Accept valid rows. For each rejected row, retain only its original array index
and stable reason codes; do not store raw model output. Store rejection counts
and indexed reasons in the existing normalizationProcessor/source status JSON.
When no accepted rows remain, retain the prior normalized source set. Search
results describe only the supplied search input and do not authorize deletion of
unmatched old observations.

## Observation replacement

The observation key remains the downstream fitness key:

    modelId + source + family + benchmark + benchmarkVersion + effort
      + canonical reasoning config + canonical metric

Value, quote, URL, and sourceVersion are not key fields. Extract/share the
existing fitness observation key calculation without changing its field order,
family mapping, metric canonicalization, or stable config encoding. Use that
key to remove previous rows matching accepted observations, then replace the
source set with accepted rows plus unmatched old rows. A changed value therefore
replaces the prior observation even when evidenceHash changes. Do not use
evidenceHash to decide observation identity or accumulate old and new values.

Map ollama-search-structured-output through the same benchmark-to-family rules
already used for Hugging Face and DuckDuckGo normalized evidence. Keep fitness
scoring and profile formulas unchanged.

## Boundaries

- No provider, route, model, paid fallback, score formula, threshold, or
  capability changes.
- No cached full-page evidence exists in this path. Keep provenance to the
  current URL, title, and snippet; do not fetch pages or add provenance fields.
- Tests remain offline and mocked. No model/provider/API/network requests.
- GitHub build and runtime acceptance are follow-up gates, not local test claims.
