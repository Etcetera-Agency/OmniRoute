# Change: Fix the consumers/requests_per_day shape and adopt one shared contract fixture

## Why

The `align-fmo-pools-contract-ingest` change made OmniRoute accept the canonical
`fmo-pools/v1`, but two defects mean a real FMO publish still fails to round-trip:

1. **`demand.consumers` type is wrong.** OmniRoute declares
   `consumers: z.array(nonEmptyString)`, but the concept §4 contract — and the FMO
   publisher — model `consumers` as a **count** (`"consumers": 4`). The real FMO payload
   is rejected. Proven by validating the FMO fixture against the OmniRoute schema:
   `REJECT @ pools.0.demand.consumers — expected array, received number`.
2. **`demand.requests_per_day` is `int`-only.** FMO emits it as a float
   (`float(demand)`); whole numbers pass `z.int()`, but a fractional forecast 400s.

The safeguard that should have caught this was not built as specced. Both prior slices
called for **one shared golden fixture mirrored across repos**, but each repo wrote its
**own** fixture with conflicting shapes (`consumers: 3` vs `consumers: ["hermes"]`), so
neither conformance test validates the same contract and drift is undetectable.

This change corrects the OmniRoute schema and replaces OmniRoute's private fixture with
the single canonical shared fixture, asserted byte-identical with the FMO side.

## What Changes

- `src/shared/schemas/fmoPools.ts` — `consumers` becomes an optional positive integer
  count (`z.number().int().positive().optional()`), not a string array;
  `requests_per_day` accepts any positive finite number (FMO floats), with whole-number
  forecasts unchanged.
- `src/lib/db/fmoPools.ts` — the spec→planning mapping carries `consumers` as the count
  (already passed through; confirm type).
- `tests/fixtures/fmo/fmo-pools-v1.golden.json` — replace with the canonical shared
  fixture (identical bytes to the FMO copy), using `consumers: 4` and a whole-number
  `requests_per_day`. The full-ingest test substitutes a seeded `combo_id`; the
  schema-conformance test validates the fixture verbatim.
- `tests/unit/api/fmo-pools-contract.test.ts` — add a conformance test that loads the
  shared fixture and asserts `fmoPoolsGenerationSchema.safeParse(...).success === true`
  with no field coercions; assert `consumers` is accepted as a number.

## Impact

- **Capability**: `fmo-pool-rebalance` (modifies "Pool spec ingestion"; adds "Shared
  contract fixture conformance").
- **Reused**: existing schema, mapping, and contract test harness.
- **Net-new**: the canonical shared fixture as the single source of contract truth.
- **Pairs with**: FMO `adopt-shared-fmo-pools-fixture` (same fixture bytes, integer
  `requests_per_day`). Together they close the residual `consumers` round-trip break.
