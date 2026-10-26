# Change: Use exact models.dev zero prices in strict auto routing

## Why

`freeAccessPolicy: strict` currently admits only models in the hand-maintained
free-model budget table, or genuine keyless catalog entries. The live
`auto/coding_high_tools:free` pool contains models outside that table even
though models.dev is already synced and records exact zero input and output
prices for some models. Those candidates are rejected as `not-in-catalog`.

The normal models.dev pricing table cannot safely authorize strict routing:
its transform fills a missing output price with zero and maps some source
providers onto other OmniRoute provider IDs. Strict routing needs direct source
identity, explicit prices for both token directions, and a durable freshness
time.

## Selected design

Build a separate zero-price evidence snapshot from the raw models.dev response.
Keep the original provider ID and full model ID. Include a model only when its
raw `cost.input` and `cost.output` are both numeric zero and every other
published price field is also numeric zero. Exclude the dynamic
`openrouter/free` alias. Persist the snapshot and successful-fetch timestamp
separately from normalized pricing. Record the underlying API fetch time even
when a sync reuses the process cache. Accept evidence for at most 36 hours; a
missing, malformed, future-dated, stale, or disabled source fails closed.

At the strict-filter seam, retain current `FREE_MODEL_BUDGETS` behavior as the
first and unchanged decision path. Only when no static entry exists may a
candidate pass through fresh, exact models.dev evidence. The candidate is
already inside the upstream `:free` pool and must retain the exact provider and
model identity that was priced. This path does not create quota, free-regime,
or hard-stop claims and does not bypass other pool predicates.

Decision pseudocode:

```text
if strict policy is off:
    return the original pool
for each candidate:
    if exact static budget entry exists:
        apply existing keyless / hard-stop / live-quota rules unchanged
    else if evidence is fresh and exact provider+model is explicitly zero/zero:
        keep the candidate's existing connection allowlist
    else:
        exclude the candidate
```

## What changes

- Extract exact zero-price model identities while the successful raw models.dev
  catalog is in memory.
- Persist `{fetchedAt, modelsByProvider}` in a dedicated `key_value` namespace;
  replace it only on a successful, non-dry-run sync.
- Read the snapshot only when strict zero-cost evaluation is enabled, and pass
  it into the synchronous strict filter and inspector classification.
- Add exact provider/model matching and 36-hour freshness checks without
  changing the static budget or connection-quota path.
- Add regression tests for partial/missing/nonzero prices, provider aliases,
  the dynamic OpenRouter alias, stale/corrupt evidence, exact matches, and
  unchanged static/quota behavior.

## Non-goals

- No pricing normalization changes, provider alias expansion, fuzzy model
  matching, quota estimates, or hard-stop claims.
- No change to band membership, task scores, capabilities, request effort,
  `:free` selection, provider configuration, or the strict policy setting.
- No paid fallback, tier downgrade, provider/model substitution, or removal of
  strict zero-cost filtering.
- No update to the manual free-model budget data.

## Acceptance

- A successful models.dev sync stores exact raw zero/zero identities and a
  durable source timestamp; dry-run and failed syncs do not replace it.
- Strict filtering admits a candidate only through the existing static rules
  or a fresh exact raw zero/zero match. Missing output, stale/corrupt data,
  different provider/model identity, and `openrouter/free` are rejected.
- The models.dev path does not change connection IDs, weaken static quota
  checks, or act when strict policy is disabled.
- Focused tests pass; independent review confirms fail-closed handling and no
  out-of-band model path. After merge/deploy, live strict candidates and one
  controlled free-only tool call are checked without paid fallback.
