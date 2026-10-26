## 1. Proposal and RED tests

- [x] 1.1 Add failing extraction tests for exact numeric input/output zero,
      missing or partial prices, nonzero prices, raw provider identity, and
      exclusion of `openrouter/free`.
- [x] 1.2 Add failing storage/sync tests proving successful non-dry-run syncs
      persist the timestamped raw-evidence snapshot while dry-run/failed syncs
      leave the prior snapshot unchanged.
- [x] 1.3 Add failing strict-filter tests for exact provider/model matching,
      fresh versus stale/corrupt evidence, strict-off identity, static-entry
      precedence, and unchanged quota enforcement.

## 2. Implementation

- [x] 2.1 Extract direct raw zero/zero identities and persist them with the
      successful models.dev fetch time in a separate namespace.
- [x] 2.2 Pass the fresh evidence snapshot into strict filtering and inspector
      classification; add no alias or model-name matching.
- [x] 2.3 Apply Code Simplifier and update the root `completion.review` with
      source and test results.
- [x] 2.4 Complete independent source review and close any concrete findings.

## 3. Verification and live acceptance

- [x] 3.1 Run the focused RED/GREEN tests, full TypeScript checks, and
      OpenSpec validation; record existing unrelated typecheck failures.
- [ ] 3.2 Confirm strict policy remains enabled, verify exact live
      `auto/coding_high_tools:free` candidates, then run one minimal forced
      `check_combo(value=7)` call only if the selected candidate is still
      explicitly zero-cost and no paid or out-of-band fallback is possible.
- [ ] 3.3 Record client POST count separately from provider attempts, actual
      model/connection, tool result, cost/route evidence, deployment source and
      image digest; update this package and `openspec/TODO.md`.
