# Change: Isolate benchmark source refreshes

> Current closure: parent accepted final runtime on 2026-11-01 and authorized
> archiving. Earlier runtime-pending and health-choice statements below are
> historical; selected functional contracts remain unchanged.

## Why

Benchmark ingestion currently treats independent sources as one completeness
unit. One failed or empty direct source can stop discovery, and a partial
refresh can replace evidence that still has valid prior data. Structured
normalization also rejects an entire response when one row is bad and the
current source label is not admitted by fitness scoring.

## What Changes

Implement owner-approved design A2+B1+C1:

- Direct source errors and incomplete snapshots do not block discovery when no
  usable positive direct evidence exists. Keep existing positive-evidence
  early returns and exact active catalog ID eligibility. Check Hugging Face
  first; use the existing Ollama Search path only when Hugging Face supplies no
  usable evidence. Keep each source's actual status.
- Publish only completed, nonempty source datasets. Omit failed, incomplete,
  and source-level empty datasets from the replacement batch so their old rows
  survive. A successful source can replace a model/source pair with no matches.
  Defer global obsolete-ID cleanup during partial refresh. Replace evidence and
  publish fitness atomically; invalidate cache only after commit.
- Validate normalized rows independently. Keep valid rows, report indexed
  rejection codes/counts, and preserve the old normalized source when the
  envelope is unusable or no rows survive. Replace matching observations using
  the existing downstream observation identity; retain unmatched evidence.
- Recognize ollama-search-structured-output through the existing benchmark to
  family mapping so accepted rows reach fitness.

## Scope

- Direct source discovery gate and source ordering.
- Current benchmark snapshot replacement and atomic fitness publication.
- Normalized response row validation, rejection receipt, and per-observation
  replacement.
- Fork-owned unit regressions and OpenSpec tracking.

No scoring formula, benchmark family, provider, route, paid fallback, source
provenance expansion, or full-page fetch changes are included.

## Acceptance

- Direct error/incomplete status still reaches discovery when there is no usable
  positive direct evidence; usable Hugging Face evidence suppresses web search;
  unusable/error Hugging Face evidence allows existing web search.
- Failed direct datasets remain stored. Mixed source snapshots replace only
  completed nonempty datasets; partial refresh does not perform global
  obsolete-ID cleanup; full success keeps current cleanup behavior.
- Evidence and fitness roll back together if publication throws. Fitness cache
  invalidation occurs only after commit. An empty successful-source batch is a
  no-op with an honest receipt.
- Valid normalized rows survive alongside indexed invalid-row reasons. Invalid
  envelope, malformed JSON, non-stop finish reason, all-rejected rows, and an
  empty accepted set preserve prior normalized evidence.
- A changed value replaces its matching observation despite a changed
  evidenceHash, unmatched evidence remains, and the current normalized source
  contributes through the existing benchmark-family mapping.
- Existing model, URL, literal quote, populated-field, and finite-number checks
  remain in force. No full-page fetching or new provenance fields are added.
- Focused mocked regressions are red before implementation and green after.
  GitHub build and runtime acceptance remain open and are recorded in root
  openspec/TODO.md; do not archive this package while those gates remain open.
