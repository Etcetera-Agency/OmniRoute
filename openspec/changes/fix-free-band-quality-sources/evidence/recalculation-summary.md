# Recalculated free-band fitness — 2026-10-25

The source candidate snapshot contains 78 provider/model rows and 66 distinct
raw model IDs. Provider copies were checked for each profile; all copies agree.
The generated runtime table is keyed by lowercased raw model ID, never provider.

## AA configuration handling

The Free API snapshot has 709 unique configuration IDs. After excluding
deprecated rows and estimated general-index rows, the profile-specific AA
reference populations contain 92 coding and 89 general model identities.
Each identity contributes one selected configuration per profile. Exact
configuration counts are:

| Profile | Coding exact / same-model proxy | General exact / same-model proxy | Exact candidate configurations |
|---|---:|---:|---:|
| low | 7 / 85 | 12 / 77 | 32 of 78 rows |
| medium | 6 / 86 | 10 / 79 | 29 of 78 rows |
| high | 11 / 81 | 17 / 72 | 33 of 78 rows |

The high reference population prefers an exact `high` AA row and uses `xhigh`
only if that identity has no `high` row. Candidate rows follow their mapped
effective Hermes mode: a candidate mapped to `xhigh` uses its `xhigh` row even
when a `high` sibling exists. A missing mapped high/xhigh row uses a marked
sibling score when present, then a same-model median proxy; it is not zero.
The API schema has no normalized effort field; the published Free
API example labels its row `gpt-oss-20B (high)`. The calculation reads
recognized effort labels from API `name` first and uses paired chart suffix
metadata only when the API name has none. RED tests cover conflicting chart
metadata, exact mapped effort, and missing-effort proxies. Slug is never used
to group configurations.

## Score coverage and bands

The three profiles each produce numeric coding and general scores for 43 of 66
raw model IDs. Their source rows are 18 AA Coding, 32 family-median coding,
and 3 general-to-coding fallbacks; general rows are 44 AA Intelligence and 9
coding-to-general fallbacks. Sources can overlap because AA Coding is included
in a family median when benchmark-family evidence exists. The other 23 raw IDs
remain null in this measured snapshot and fall through to the existing
models.dev capability estimate for an explicit free request when that row is
available.

The configured inclusive ranges are unchanged and overlap, so band counts can
overlap. Counts by provider/model row (78-row pool):

| Profile | Coding low / mid / high | General low / mid / high |
|---|---:|---:|
| low | 34 / 15 / 11 | 39 / 15 / 8 |
| medium | 34 / 15 / 11 | 39 / 13 / 8 |
| high | 34 / 15 / 11 | 39 / 13 / 8 |

Counts by distinct raw model ID (66 IDs):

| Profile | Coding low / mid / high | General low / mid / high |
|---|---:|---:|
| low | 25 / 13 / 11 | 30 / 13 / 8 |
| medium | 25 / 13 / 11 | 30 / 12 / 8 |
| high | 25 / 13 / 11 | 30 / 12 / 8 |

The estimator skips benchmark/version cohorts with fewer than five model
identities. A benchmark-only coding score needs two independent families; AA
Coding may stand alone. Small singleton subsets therefore contribute no vote,
and the model remains null unless another approved source or the reciprocal
task fallback provides a score. No `.5` neutral score is invented.

## Remaining uncertainty

Leave-one-family-out checks still change coding/general band membership for
7–12 raw IDs depending on profile and removed family. These scores are relative
fitness estimates, not probabilities of task success. The 0.70 high cutoff
and all configured ranges were left unchanged. This is an offline source
snapshot; it does not establish that the live server uses this revision or
that a live pool is populated.

Full per-model scores, source votes, raw reference counts, and input SHA256
values are in `aa-low.json`, `aa-medium.json`, `aa-high.json`,
`unified-low.json`, `unified-medium.json`, `unified-high.json`, and
`benchmarkConsensusFitness.ts`.

Offline calculation checks pass: 25 AA/configuration tests and 18 unified
estimator tests. The checked-in OpenSpec package includes the calculator and
frozen inputs; test files live under `tests/unit/aa-band-quality/` per repo
layout rules.
