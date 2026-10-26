# Artificial Analysis API configuration fields

Checked against the official API reference on 2026-10-25:

- Free list: [`GET /api/v2/language/models/free`](https://artificialanalysis.ai/data-api/docs/reference)
  returns each row's `id`, `name`, `slug`, `release_date`, `model_creator`, and
  `evaluations`. The published example is `gpt-oss-20B (high)` with its own ID
  and Coding/Intelligence indices. `name` is the only documented API field
  exposing a configuration label; the example confirms `(high)`, but the
  schema does not define a normalized effort enum.
- Pro list: [`GET /api/v2/language/models`](https://artificialanalysis.ai/data-api/docs/reference)
  adds `reasoning_model: boolean` and per-benchmark evaluation fields. The
  documented schema has no `reasoning_effort` or `base_model_id` field.
  `reasoning_model` only identifies a reasoning model, not its effort. Pro's
  `reasoning_cost` and `reasoning_tokens` are usage/cost breakdowns, not effort
  labels. Free returns headline indices, including Coding and Intelligence;
  its per-benchmark fields are omitted.
- The captured Free snapshot has separate `gpt-oss-20b (Low)` and
  `gpt-oss-20b (High)` records with distinct IDs. Their slugs also differ:
  `gpt-oss-20b-low` and `gpt-oss-20b`. Slug cannot identify the base model.
- The public chart metadata paired to the same 709 API IDs provides `suffix`
  and `isReasoning`. Prefer a recognized effort suffix in the API `name`; use
  chart `suffix` only when the name has no recognized suffix. In this snapshot,
  grouping by creator, base name after stripping that suffix, and release date
  yields 514 model identities, of which 120 have multiple configuration rows.
  The per-profile AA reference selects at most one configuration per identity,
  preferring exact low/medium/high and using xhigh only when high is absent.
  Candidate rows follow their mapped effective Hermes mode: a mapped xhigh
  uses the AA xhigh row even when a high sibling exists. Missing mapped rows
  use a marked same-model estimate; high and xhigh are never combined.

Free API per-benchmark evaluation fields are omitted. The profile's AA Coding
and Intelligence indices come from its configuration row; other benchmark
families come from the separately hashed benchmark snapshots in this package.
