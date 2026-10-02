# Change: Add band-channel grammar and auto-routing pool seams

## Why

FMO rebalance is replaced by quality bands inside upstream `auto/*` routing. The
feature lives on a fork branch that is rebased onto every upstream release, and
upstream moves about 5,000 commits per quarter. This slice recognizes band
channels, defaults an omitted band tier to `thrifty` while the feature is
enabled, and gives enabled band-only `thrifty` requests their agreed rung order.
It also adds tests that detect a
broken sync before quality-band filtering and demand reserve are implemented.

## What Changes

- New module `open-sse/services/autoCombo/bands/` (fork-only):
  - `grammar.ts` — parse `<task>_<band>[_<cap>...]`.
  - `index.ts` — the seam API: `parseBandCategory()`, `buildBandCheck()`,
    `isBandsEnabled()`.
- Hooks in `open-sse/services/autoCombo/suffixComposition.ts` and
  `open-sse/services/autoCombo/virtualFactory.ts`:
  - `parseAutoSuffix` recognizes `<task>_<band>[_<cap>...][:<tier>]`.
  - `buildAutoCandidateFilter` appends the band check when one exists.
  - the virtual factory applies the band-only rung order for effective
    `thrifty` requests. The later demand-reserve slice uses this same pool seam
    to narrow account IDs before ordering and dispatch.
- Band channels are valid ids from this slice on. Band enforcement arrives in
  `add-auto-quality-band-filter`; until then a band channel resolves to the
  nearest upstream category (degraded resolution).
- Tests that fail loudly after a bad upstream sync: seam presence, upstream
  identity, upstream contracts.
- Branch bootstrap: base tag, fork-only `openspec/`, deploy tag naming,
  production database start check.

## Impact

- Affected specs: `auto-quality-bands` (new capability).
- Affected code:
  - `open-sse/services/autoCombo/suffixComposition.ts` (parser/filter seam).
  - `open-sse/services/autoCombo/virtualFactory.ts` (band pool seam).
  - New: `open-sse/services/autoCombo/bands/{grammar,index}.ts`.
  - New: `tests/unit/autoCombo/bands-{grammar,seam,identity,contracts}.test.ts`.
- Not touched: `src/sse/handlers/chat.ts`, `featureFlagDefinitions.ts`,
  `instrumentation-node.ts`, combo schemas,
  `src/lib/db/migrations/`.
- Unblocks: `add-auto-quality-band-filter`, `add-auto-band-demand-reserve`.
