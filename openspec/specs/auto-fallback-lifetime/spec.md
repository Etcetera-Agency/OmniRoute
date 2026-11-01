# auto-fallback-lifetime Specification

## Purpose

Define native finite Auto fallback and strict-free benchmark normalization within the saved combo request budget.

## Requirements

### Requirement: Configure native total deadline

Production SHALL persist comboDefaults.comboTimeoutMs=1200000 using the existing
settings API. Native merge precedence, target deadlines, cancellation and loop
implementation SHALL remain unchanged. First calls and retries SHALL retain the
shared attempt cap30 by default, hard200. Native model-error streak guard SHALL
remain unchanged. Existing strict-free filters and scoring SHALL remain unchanged.

#### Scenario: Saved deadline permits long benchmark fallback

- **GIVEN** native total budget1200000 and benchmark normalizer caller budget1200000
- **WHEN** first candidate times out after400000 and second succeeds after another250000
- **THEN** the first target is aborted and the successful normalization response returns
- **AND** total650000 exceeds the implicit600000 window without source modifications

### Requirement: Unknown-model normalization uses native free Auto fallback

A model in the active synced catalog without benchmark evidence SHALL use the
existing optional discovery and strict-free general-high SO normalization path.
No paid or out-of-band fallback SHALL be admitted.

#### Scenario: Immediate upstream504 then success

- **WHEN** the first free SO candidate returns504 and the next succeeds
- **THEN** normalized candidate evidence is returned from the successful response

#### Scenario: Pool exhaustion settles queue

- **WHEN** every admitted normalizer candidate fails
- **THEN** the caller receives the native aggregate OmniRoute failure
- **AND** queue work leaves running state and records normalization failure

#### Scenario: Native cooldown applies to next selection

- **GIVEN** stored modelLockout.enabled=true and one exact tuple failed504
- **WHEN** a new strict-free SO Auto request starts before cooldown expiry
- **THEN** that tuple is excluded and eligible sibling model/account remains usable
