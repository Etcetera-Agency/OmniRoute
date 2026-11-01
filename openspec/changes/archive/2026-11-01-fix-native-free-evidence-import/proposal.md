# Change: Preserve exact native zero-price evidence

> Current closure: parent accepted final runtime on 2026-11-01 and authorized
> archiving. Earlier runtime-pending and health-choice statements below are
> historical; selected functional contracts remain unchanged.

## Why

The fork's models.dev zero-price snapshot is source evidence for the strict
zero-cost candidate filter. The fork currently expires that snapshot after 36
hours even though its stored `fetchedAt` is provenance, not a freshness lease.
The extraction also stores raw provider IDs while native pricing and capability
transforms map models.dev IDs to OmniRoute IDs. Thus a raw `kilo` model is
recorded under `kilo`, while strict candidates use `kilocode`. These defects
exclude exact zero-price candidates without changing the upstream strict
zero-cost policy.

## What Changes

Remove the fork-owned 36-hour age rejection for models.dev zero-price evidence
and compatible-metadata pricing snapshots. Keep rejecting missing, malformed,
and future timestamps; retain original fetched timestamps as provenance. Keep
upstream v3.8.52 strict-zero behavior, FreeModelBudget classification, dynamic
`openrouter/free` exclusion, and all quota and hard-stop checks intact.

During extraction, use `mapProviderId()` and let the last raw provider entry
mapped to a canonical provider own its evidence model set. Require effective
explicit zero prices from `transformModelsDevToPricing` and numeric zero for
every additional raw price. Do not infer model aliases.

Compatible pricing still requires exact IDs, active eligible connections,
complete prices and consensus across every eligible connection. Remove only
the age cutoff for pricing snapshots. Capability false vetoes and unknown
behavior remain unchanged; capability resolution does not use the pricing-age
helper.

## Scope

- Remove fork-local 36-hour expiry from models.dev and compatible pricing
  evidence while retaining malformed/future timestamp rejection.
- Match mapped-provider model-set precedence and effective native zero prices.
- Cover alias collisions, compatible price completeness/consensus, capability
  veto/unknown, identity, and static quota/hard-stop behavior with regressions.
- Preserve static catalog precedence and existing strict access checks.
- Record unresolved live acceptance in root `openspec/TODO.md`.

## Non-goals

- Do not remove or weaken upstream strict-zero filtering or free-access policy.
- Do not add response cost fields, financial metadata gates, score changes,
  thresholds, pool expansion, or paid fallback.
- Do not edit keys, settings, permissions, other providers, or other strict
  guards.
- Do not perform provider/model/HTTP/network calls, production writes,
  restarts, builds, deployment, commits, or pushes.

## Acceptance

- Exact zero input/output evidence with `structured_output: true` and a genuine
  `fetchedAt` older than 36 hours remains eligible when provider and model IDs
  match exactly.
- Raw `kilo` evidence maps to canonical `kilocode`, with the exact model ID,
  and final mapped-provider ownership matches the selected rule.
- Old complete and consistent compatible 0/0 prices remain evidence; missing,
  nonzero, conflicting, malformed, and future prices stay excluded.
- Capability explicit false still vetoes; unknown stays unknown.
- Missing IDs, absent evidence, partial/nonzero pricing, and dynamic
  `openrouter/free` remain excluded.
- Static FreeModelBudget entries continue to use their existing quota and
  hard-stop rules, regardless of imported snapshot age.
- Focused regression is RED before implementation and GREEN afterward; focused
  checks and strict OpenSpec validation pass.
- Deployment and passive native metadata/candidate acceptance remain open and
  are recorded in `openspec/TODO.md`; no completion marker is created while
  these gates remain open. Provider/model inference is prohibited and is not a
  required billing-proof gate; unrun inference remains a verification limitation.
