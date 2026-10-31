## ADDED Requirements

### Requirement: Enable native lockout through stored production settings

Production SHALL persist modelLockout.enabled=true through the existing settings
API. Backend and UI default constants SHALL remain unchanged. Existing error-code,
cooldown, backoff and explicit disable semantics SHALL remain intact.

#### Scenario: Enable existing server setting

- **WHEN** the operator configures enabled=true with the native settings API
- **THEN** GET returns enabled=true and runtime uses existing timeout lockout

#### Scenario: Preserve upstream defaults and reset semantics

- **WHEN** the setting is absent or Reset Defaults is selected
- **THEN** upstream false remains the default
- **AND** UI changes are not persisted until Save

### Requirement: Record recognized upstream timeout responses without cooling unrelated request failures

The system SHALL preserve upstream model-lockout eligibility unchanged. Ordinary
upstream504 and synthetic combo_target_timeout SHALL use the existing recorder.
No new upstream_response_failed exception SHALL be introduced.

#### Scenario: Ordinary upstream 504

GIVEN the upstream returns HTTP 504 and the failure is not request-scoped
AND ModelLockout is enabled with 504 in its error-code list
WHEN the combo records the failed target
THEN a model lockout is recorded using the existing exact 5xx scope and
cooldown policy

#### Scenario: Synthetic target timeout

GIVEN the local per-target timer returns HTTP 504 with code
`combo_target_timeout`
AND ModelLockout is enabled with 504 in its error-code list
WHEN the combo records the failed target
THEN a model lockout is recorded
AND no provider-wide or connection-wide cooldown is added by this change

#### Scenario: Unrelated request-scoped failure

GIVEN a request-scoped validation, resource/queue, or client-cancel failure
WHEN the combo records the failed target
THEN no model lockout is recorded

### Requirement: Apply exact timeout lockout to a later Auto candidate build

After a timeout lockout is recorded, the system SHALL use existing Auto
candidate filtering to exclude the locked provider/connection/model tuple from
a subsequent dispatch pool. It SHALL preserve unlocked sibling models and
connections and SHALL make the tuple eligible again after the existing
lockout expires or is explicitly cleared.

#### Scenario: Cooled tuple removed while sibling target remains eligible

GIVEN one model/connection tuple has an active timeout lockout
AND a sibling model or connection is not locked
WHEN Auto builds a new dispatch candidate pool
THEN the cooled tuple is excluded or its connection is removed from the
candidate's allowed connection IDs
AND the unlocked sibling remains eligible

#### Scenario: Expired timeout lockout is eligible again

GIVEN the exact timeout lockout has passed its existing cooldown
WHEN Auto builds a new dispatch candidate pool
THEN the previously cooled tuple is eligible again
