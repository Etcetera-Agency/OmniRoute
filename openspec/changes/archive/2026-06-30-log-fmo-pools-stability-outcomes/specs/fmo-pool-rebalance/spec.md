# fmo-pool-rebalance Specification

## MODIFIED Requirements

### Requirement: Generation stability

The system SHALL prefer incumbent candidates over challengers unless a challenger
beats the incumbency margin, and SHALL keep a provider/model pinned to its previous
`connectionId` as a hard rule while that account is alive and not exhausted, adding new
accounts at the margin rather than reshuffling placed pins; this retention SHALL NOT be
reducible to a soft scoring nudge that a small input shift can overturn. Stability SHALL
apply only among eligible candidates and SHALL NOT override capability, context, band,
free, or quota gates; a degraded incumbent SHALL be dropped immediately. The system
SHALL NOT mix account-pinned and account-unpinned entries for the same provider in one
generation, and SHALL enforce this with an explicit per-provider assertion that fails the
generation and logs the violation when both pinned and unpinned head entries appear for
one provider. The system SHALL record stability outcomes for every incumbent — `kept`
(survived a within-margin challenger), `displaced` (beaten by a challenger), and
`dropped` (ineligible) — each with a reason.

#### Scenario: Incumbent kept within margin

- GIVEN an incumbent member and a challenger that does not beat the incumbency margin
- WHEN the pool is solved
- THEN the incumbent keeps its seat
- AND the decision record marks it as `kept` with the challenger and delta in the reason

#### Scenario: Incumbent displaced beyond margin

- GIVEN an incumbent member and a challenger that beats the incumbency margin
- WHEN the pool is solved
- THEN the challenger takes the seat
- AND the decision record marks the incumbent as `displaced` with the delta

#### Scenario: Live pin retained as a hard rule

- GIVEN a previous-generation pin that is in-band, capable, not exhausted, and on a live account
- WHEN the next generation is solved after a small input shift
- THEN the pin keeps its `connectionId`
- AND new accounts are added only at the margin for unfilled demand

#### Scenario: Degraded incumbent dropped

- GIVEN an incumbent that fell out of band or exhausted its quota
- WHEN the pool is solved
- THEN the incumbent is dropped immediately with no margin
- AND the decision record carries the `dropped` reason

#### Scenario: No mixed pinning per provider

- GIVEN a provider used across several combos in one generation
- WHEN the plan is built
- THEN that provider's entries are either all account-pinned or all account-unpinned
- AND a mixed-pin plan fails the generation and logs the violation
