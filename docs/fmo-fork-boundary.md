# FMO Fork Boundary

OmniRoute owns the FMO pool ingestion, solve, tail, and atomic apply data plane.
Hermes remains the external manager that decides when to publish pool generations.

## Ownership

- Hermes publishes versioned `fmo-pools/v1` generations to `PUT/POST /api/fmo/pools`.
- OmniRoute validates and stores accepted generations behind `OMNIROUTE_FMO_POOLS_ENABLED`.
- OmniRoute builds plans, appends configured tail entries, and applies existing combo rows atomically.
- OmniRoute does not create missing combos for FMO and fails the whole generation when a referenced combo is absent.

## Runtime Rules

- Materialized FMO combos are ordinary `priority` combos on the request hot path.
- Shadow rebalance returns a live diff and writes nothing.
- Apply writes combo rows, decision records, and the apply marker in one DB transaction.
- Tail entries are account-unpinned and never counted as forecast capacity.
