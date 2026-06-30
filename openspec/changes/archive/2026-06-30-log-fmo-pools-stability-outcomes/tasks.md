# Implementation Tasks

- [x] `src/lib/fmoPools/packing.ts` — during per-pool fill, track incumbents from the
      prior; emit `kept` when an incumbent survives a within-margin challenger (reason
      includes challenger key + delta), emit `displaced` when a challenger beats the
      margin.
- [x] Add a hard-stickiness pass: retain an eligible prior pin (in-band, capable,
      `quota > 0`, account alive) before scoring challengers; challengers fill only the
      remaining demand / new accounts. Keep degraded-incumbent immediate drop.
- [x] After plan build, assert per-provider no-mix: collect each provider's head members,
      fail + log if a provider has both pinned and unpinned head entries in one generation.
- [x] Tests (`tests/unit/fmo-pools-solve-tail.test.ts` / planning): a within-margin
      challenger yields a `kept` record; a margin-beating challenger yields `displaced`; an
      eligible prior pin is retained even after a small score shift; a degraded incumbent
      is still dropped; a constructed mixed-pin plan trips the no-mix assertion.
