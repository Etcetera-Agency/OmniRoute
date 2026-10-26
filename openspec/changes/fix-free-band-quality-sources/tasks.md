## 1. RED tests

- [x] 1.1 Cover global raw model ID lookup and prove capability-derived
      models.dev fitness does not create a `user_override` row.
- [x] 1.2 Add failing band-filter cases for per-band benchmark profile selection:
      low→low, mid→medium, high→high; prove the selected profile is passed to
      the score resolver.
- [x] 1.3 Add failing band-filter cases proving both special sources count
      only for explicit `:free`, and `models_dev_tier` remains the approved
      fallback after benchmark fitness for all three free bands even when a
      custom rated-source list names it.
- [x] 1.4 Add failing snapshot lookup cases for exact raw IDs, absent/null
      scores, real numeric zero, and a benchmark-only model with fewer than two
      independent families.
- [x] 1.5 Cover successful models.dev capability sync visibility and verify
      failed/dry-run syncs do not publish capability rows.

## 2. Implementation

- [x] 2.1 Recalculate the 2026-10-25 profiles using the selected effective AA
      effort. Candidate scores use the mapped exact effort; generic high
      references prefer `high`, then `xhigh`. For benchmark observations, use
      exact effort, then a marked high/xhigh sibling, unknown-effort, or
      cross-effort median proxy. Preserve proxy provenance and numeric zero;
      exclude benchmark cohorts under five models and require two coding
      families without AA Coding. Fail on conflicting provider copies; keep
      profile outputs separate and retain input hashes.
- [x] 2.2 Resolve the requested band's profile before the existing models.dev
      fallback. Preserve user override, Arena, inherited-score priority and the
      existing task fallback semantics.
- [x] 2.3 Count `benchmark_consensus` and `models_dev_tier` as rated only for
      explicit `:free`. Use `models_dev_tier` after benchmark fitness as the
      approved fallback for all three free bands. Keep capability predicates,
      configured ranges, strict zero-cost behavior, and empty-pool semantics.
- [x] 2.4 Keep successful models.dev capability writes connected to the current
      AutoCombo cache invalidation generation.
- [x] 2.5 Apply Code Simplifier, update `completion.review`, and record the
      independent review of this complete diff.

## 3. Verification and acceptance

- [x] 3.1 Run focused snapshot, task-fitness, band-filter, cache-sync, and
      relevant type checks in a Linux-compatible dependency environment.
- [x] 3.2 Verify strict OpenSpec validation.
- [x] 3.3 Verify all three recalculated profiles map to the same exact model IDs
      and no provider-copy score conflicts; record evidence counts and band
      counts. Confirm one-family rows stay unrated instead of becoming zero or
      qualifying for mid/high.
- [ ] 3.4 After authorized main integration/deployment, verify exact free,
      in-band, capability-matching candidates for each requested profile.
- [ ] 3.5 Only after the live strict zero-cost route is proven, run one
      controlled tool-call smoke and record client POST count, provider-attempt
      count, actual model/connection, tool result, route, and zero-cost/no-
      fallback evidence separately.
- [ ] 3.6 Design a separate reviewed refresh process for newly added models;
      it must use the closed benchmark list and server-enforced structured
      output before any automatic rating write. Do not refresh this snapshot by
      copying models.dev capabilities into quality scores.
