# Change: Ingest APInex zero-price evidence

## Why

APInex's configured OpenAI-compatible node has current raw model IDs and an
active native strict-zero-cost gate, but its exact prices are absent from the
native `models_dev_pricing` namespace and from the raw zero-price snapshot.
The existing strict gate therefore cannot admit an APInex candidate from
source evidence.

APInex publishes a structured public model catalog at
`https://apinex.bond/api/public/models`. Its current response contains 44
model records. Each record exposes its raw API `id`, `dollarsPer1M` input price,
and `outputDollarsPer1M` output price; 21 records currently publish numeric
zero for both. The catalog page and a model page link those IDs to APInex's
OpenAI-compatible API. This change uses only those structured fields; display
provider labels, names, and ID prefixes do not establish price.

## Selected design

Fetch the public catalog during a successful, non-dry-run models.dev sync in a
separate failure boundary. Identify configured APInex nodes by the existing
OpenAI-compatible chat node type and the exact APInex API endpoint. Intersect
catalog IDs with raw models already synced as available for each matching
node. Store the current APInex zero-price identities and their own fetch time
and source URL in a separate `key_value` snapshot.

Write APInex zero rows into the existing `models_dev_pricing` shape under the
exact configured node ID. Preserve that merge when the normal models.dev
pricing namespace is replaced. Keep APInex source timestamp in its separate
snapshot so a models.dev refresh cannot refresh APInex evidence.

At each existing zero-price evidence read, validate the models.dev and APInex
snapshots independently. Include each complete source only while its own fetch
time remains within the existing 36-hour age window and is not future-dated.
Recheck APInex node endpoint identity against current configuration. Compose
the surviving exact raw identities into the existing
`{fetchedAt, modelsByProvider}` shape, with `fetchedAt` equal to the oldest
included source time. Do not change strict filtering, candidate construction,
hidden/excluded state, or provider availability.

## What changes

- Parse the official APInex public catalog and require complete numeric price
  fields and unique, non-empty raw IDs before replacing current source data.
- Authorize only records with numeric input and output prices exactly equal to
  zero, with no other published per-token price field that is nonzero.
- Bind those IDs only to configured APInex endpoint nodes and their existing
  synced available raw model IDs.
- Persist only the current APInex evidence snapshot with source URL and fetch
  timestamp; leave the previous snapshot unchanged on fetch or parse failure.
- Merge exact APInex zero-price entries into the existing
  `models_dev_pricing` namespace without changing models.dev's own evidence or
  capability writes.
- Recompose the existing strict-zero-cost evidence input from independently
  fresh sources on each read; do not edit `strictZeroCostFilter.ts`.
- Add focused regressions for APInex source parsing, identity binding,
  freshness composition, persistence, and independent source failures.

## Non-goals

- No strict-filter, free-budget, quota, band, score, capability, hidden-model,
  exclusion, connection, routing, or candidate-pool changes.
- No name, display-provider, prefix, alias, or fuzzy model matching.
- No source-history table, raw-catalog archive, manual free-model entry, or
  runtime/provider probe.
- No paid or out-of-band fallback change.

## Acceptance

- APInex zero-price entries are sourced only from complete official structured
  records with explicit numeric zero input and output prices.
- Only exact APInex node IDs and exact currently synced available raw model IDs
  receive zero-price entries; source ingestion does not modify availability,
  hidden, or exclusion state.
- Models.dev and APInex freshness remain independent. Each source is included
  only when individually fresh; the composed timestamp is the oldest included
  source timestamp.
- A failed APInex fetch does not fail a successful models.dev sync and does
  not refresh or replace the APInex source timestamp.
- Existing strict behavior remains unchanged. The original benchmark task
  remains open until separate native free-only live acceptance succeeds.
