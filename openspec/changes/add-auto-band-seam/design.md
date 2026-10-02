## Context

Upstream between 2026-07-07 and 2026-10-02: about 5,000 commits; numbered
migrations reach 196. File change counts in that window: `suffixComposition.ts` 4,
`engine.ts` 5, `resolveAutoStrategy.ts` 12, `virtualFactory.ts` 44,
`featureFlagDefinitions.ts` 49, `src/sse/handlers/chat.ts` 119.

Every path that resolves an `auto/*` id goes through `parseAutoSuffix` and
`buildAutoCandidateFilter` in `suffixComposition.ts`. That predicate is applied
to the candidate pool in `virtualFactory.ts` before scoring. Pool-level
operations also belong at this factory seam: a predicate cannot reorder rungs
or narrow a multi-account candidate's allowed connection IDs.

## Goals / Non-Goals

- Goals:
  - Keep upstream integration to the parser/filter seam and the virtual-factory
    pool seam.
  - Upstream ids behave exactly as upstream.
  - A sync that drops or breaks the seam fails CI, not production.
  - Band channels never return 400 once Hermes profiles point at them.
- Non-Goals:
  - Band enforcement (slice 2), demand reserve (slice 3).
  - Advertising band channels in `/v1/models`.
  - Pinning the scoring task type.

## Decisions

### Seam location

`suffixComposition.ts` owns grammar recognition and per-candidate band and
capability predicates. `virtualFactory.ts` owns the list-level work after
upstream tier eligibility has been applied: band-only account narrowing before
dispatch and band-only rung ordering before scoring. Keep the behavior behind
the recognized band-channel condition so ordinary upstream channels retain
their current path. A router strategy would affect only the first target and
would not protect the fallback chain; persisted combos would also bypass the
virtual factory's pool filters.

### Grammar: `auto/<task>_<band>[_<cap>...][:<tier>]`

Task, band, capabilities and tier are independent axes. Capabilities are
optional extra `_` segments from a fixed set (`tools`, `so`, `reasoning`,
`vision`), in any
order, each at most once: `auto/general_high_tools:free`,
`auto/general_low_tools_so:free`. They are parsed here and enforced as static
hard filters in `add-auto-quality-band-filter`; they are not part of the task or
the band.

- `_` is the separator because:
  - the candidates route accepts only `[a-zA-Z0-9:_-]`
    (`api/v1/auto-combo/[channel]/candidates/route.ts:23`), so `@` and `.` fail;
  - effort splitters strip a trailing `-low`, `-medium`, `-high`
    (`reasoningSuffix.ts:52-55`, `providerModels.ts:359`), so `-` is unsafe.
- The tier segment stays upstream's. With `OMNIROUTE_AUTO_BANDS` enabled, an
  absent tier on a band channel defaults to `thrifty`; with the flag disabled,
  the adapter leaves it absent so upstream chooses its default. Explicit tiers
  are preserved in either mode. An absent tier on ordinary upstream channels
  is unchanged. A future upstream third `:`
  segment or new category names do not collide with
  `<task>_<band>[_<cap>...]`.
- Upstream template ids and flat variants are resolved before `parseAutoSuffix`
  (`autoRouting.ts:39-52`), so they keep priority.

### Hook shape

```ts
// suffixComposition.ts
import { parseBandCategory, buildBandCheck } from "./bands"; // AICODE-NOTE: bands seam

export function parseAutoSuffix(suffix) {
  // ...existing split into [head, tail]...
  const band = parseBandCategory(head); // AICODE-NOTE: bands seam
  if (band) {
    if (tail !== undefined && !TIER_SET.has(tail)) return { valid: false };
    const enabled = isBandsEnabled();
    let upstreamCategory = "chat";
    if (band.task === "coding") upstreamCategory = "coding";
    if (band.hasReasoning) upstreamCategory = "reasoning";
    if (band.hasVision) upstreamCategory = "vision";
    return {
      valid: true,
      category: (enabled ? band.category : upstreamCategory) as AutoCategory,
      tier: (enabled ? (tail ?? "thrifty") : tail) as AutoTier,
    };
  }
  // ...existing logic unchanged...
}

export function buildAutoCandidateFilter(category, tier) {
  const checks = [];
  // ...existing logic unchanged (vision / reasoning / free / pro checks)...
  const bandCheck = buildBandCheck(category); // AICODE-NOTE: bands seam
  if (bandCheck) checks.push(bandCheck); // last: runs only for tier-eligible candidates
  if (checks.length === 0) return null;
  return (candidate) => checks.every((fn) => fn(candidate));
}
```

The pool-level behavior is applied in `virtualFactory.ts` after its existing
category/tier eligibility filters. The pseudocode states the scope and order;
the implementation may use the local factory seam without changing public
interfaces:

```ts
if (isBandsEnabled() && isBandChannel(spec)) {
  if (reserveEnabled) candidatePool = narrowReservedAccounts(candidatePool, band);
  if (effectiveTier === "thrifty") {
    candidatePool = orderByRung(candidatePool, [
      "free",
      "keyless",
      "subscription",
      "cheap",
      "premium",
    ]);
  }
}
// With the flag off, band and ordinary channels use the upstream path:
// no band predicate, no reserve/account mutation, and no band rung order.
```

With the flag enabled, an omitted tier on a band channel means `thrifty`;
explicit `:free`, `:subscription`, `:cheap`, or other upstream tiers keep their
existing eligibility semantics. The band-specific rung preference changes
priority among candidates that remain eligible. It does not itself exclude
candidates for quality or economic class; upstream quota, budget, zero-cost,
and other availability checks continue to decide eligibility. With the flag
disabled, leave the tier omitted when it was omitted in the requested id and
leave candidate account IDs untouched.

`band.category` is:

- degraded: `vision` when the channel carries the `vision` capability, else
  `reasoning` when it carries `reasoning`, else `coding` for task `coding`,
  else `chat`. `vision` and `reasoning` are existing upstream categories with
  their own capability filter, so that part of the guarantee survives the kill
  switch. Upstream's own per-request
  compatibility filter (tools, structured output, vision) still applies;
- enforced (slice 2, flag on): the opaque string `<task>_<band>[_<cap>...]`, carried through
  `spec.category` to `buildAutoCandidateFilter`.

`buildBandCheck` returns `null` in this slice.

### Kill switch

`OMNIROUTE_AUTO_BANDS` unset or `0` → degraded resolution. The grammar adapter
still accepts band ids and maps them to native upstream categories so existing
band-channel requests do not fail, but it leaves an omitted tier unset and
preserves only an explicitly requested tier. Quality and capability band
predicates are not registered; band-only rung ordering and reserve/account
narrowing are bypassed; `allowedConnectionIds` remain unchanged. All ordinary
upstream channels retain their unmodified path. This is the full routing
rollback possible while continuing to accept the fork's band-channel syntax.

### Branch and sync process

- Base: upstream `release/v3.8.52` at `23a11484862b3bb589a55e85b00e4ac53ffeb234`.
  Branch `feat/auto-quality-bands` = base + commits:
  1. fork-only `openspec/`;
  2. `bands/` module and tests;
  3. the two hooks.
- New upstream tag: `git rebase --onto <new-tag> <old-tag> feat/auto-bands`.
- Deploy tags: `<upstream-tag>-bands.<n>`. Production pins a tag.
- Fork delta is always `git diff <upstream-release-ref>..HEAD --stat`.
- Gate after each rebase: `bands-*` tests, upstream autoCombo unit tests,
  typecheck.

## Risks / Trade-offs

- Upstream rewrites `suffixComposition.ts` → seam test fails; re-apply two hooks.
- Upstream adds its own `_` grammar → identity test fails on the new ids;
  rename the separator in `grammar.ts` only.
- Opaque category string reaches code that switches on `AutoCategory` →
  contract test builds a virtual combo with an opaque category.
- Non-`chat` category selects the `quality-first` pack (`virtualFactory.ts:1134`),
  so `general_low` also scores quality-first once enforced. Accepted: inside a
  band, best-in-band is the intended pick.

## Migration Plan

1. Create the branch from the tag, add `openspec/`, move these proposals in.
2. Land module + tests, then hooks.
3. Start the build on a copy of the production database before any deploy.
   Upstream 118–120 are `provider_param_filters`, `model_capability_overrides`,
   `interception_rules`; the fork used 118–120 for FMO tables.
4. Deploy with `OMNIROUTE_AUTO_BANDS` unset. Rollback: redeploy previous tag.

## Required pre-implementation checks

- Verify `auto/coding_high` (no tier) survives `applyReasoningRouting` in
  `chat.ts` unchanged.
- Verify `call_logs.combo_name` retains the full band channel id; slice 3
  depends on it.
