## 1. Specify and prove the existing identity seam

- [x] 1.1 Confirm deployed source at `df19cd81e3` matches selected remote-main
      source `437d22e2ba` for the identity/capability/fitness files.
- [x] 1.2 Confirm the indexed graph points to a different worktree/commit and
      treat it only as navigation evidence.
- [x] 1.3 Record the exact-only binding, direct-source precedence, raw dispatch
      ID, and non-goals in the proposal/design/spec deltas.

## 2. TDD exact identity behavior

- [x] 2.1 Add a failing regression for exact raw `free/muse-spark-1.3` binding
      in `resolveScoresAs` and native capability resolution.
- [x] 2.2 Add failing unknown/prefix-only identity cases, including a `free/`
      value whose basename could otherwise resolve to a catalog ID, and prove
      an exact ID still wins when longer IDs share its prefix.
- [x] 2.3 Add failing capability-consensus and provider-scoped `false` /
      vision-override precedence cases.
- [x] 2.4 Add failing inherited global/profile `coding` and `general` cases,
      preserving source priority, profile isolation, and expired-score gating.
- [x] 2.5 Add a native band regression proving the raw route ID and supplied
      pool membership stay unchanged; do not edit band predicates.
- [x] 2.6 Add an AutoCombo-preparation regression proving exact raw hidden keys
      and per-connection raw/base exclusions still use the raw ID after
      canonical capability evidence is attached.
- [x] 2.7 Prove an unanchored nested free ID cannot inherit an exact leaf-keyed
      synced capability row.
- [x] 2.8 Prove an unanchored effort variant cannot inherit a sibling base's
      capability fields.
- [x] 2.9 Prove an unanchored vision-family path stays unknown without direct
      provider evidence.

## 3. Implement the bounded binding

- [x] 3.1 Add an exact registry-ID lookup for all provider copies and a strict
      `free/<base>` canonical anchor.
- [x] 3.2 Resolve shared capabilities by exact ID and unanimous field values,
      beneath all current provider-scoped sources/overrides; keep synced model
      lookups exact and require the registry anchor before reading base rows.
- [x] 3.3 Add the strict `free-prefix` score identity tier; leave existing
      non-free explicit/effort/`-free` rules unchanged.
- [x] 3.4 Run Code Simplifier on the completed source/tests and update this
      package's `completion.review` plus repo `openspec/TODO.md`.

## 4. Verify and record

- [x] 4.1 Run the focused resolver, capability, fitness, and native-band tests.
- [x] 4.2 Run strict OpenSpec validation and changed-file format/diff checks.
- [x] 4.3 Complete source review and record the local commit; do not push,
      merge, build an image, or deploy in this package.
- [x] 4.4 Keep the separate APInex free-catalog entitlement/pricing adapter and
      live native acceptance tracked in repo `openspec/TODO.md`.
