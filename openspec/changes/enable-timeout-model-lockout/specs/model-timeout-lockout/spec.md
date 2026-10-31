## ADDED Requirements

### Requirement: Enable model lockout by default with an explicit opt-out

The system SHALL enable ModelLockout when its setting is omitted and SHALL
preserve an operator's explicit `modelLockout.enabled: false` value. Existing
error-code, cooldown, and backoff settings SHALL retain their current meaning.

#### Scenario: Model lockout setting omitted

GIVEN no `modelLockout` setting is supplied
WHEN runtime resilience settings are resolved
THEN ModelLockout is enabled
AND HTTP 504 remains in the configured default error-code set
AND the existing 120-second base cooldown and backoff limits remain unchanged

#### Scenario: Dashboard defaults match the enabled backend default

GIVEN the settings response omits `modelLockout.enabled`
WHEN the dashboard loads settings or the operator resets defaults
THEN the enabled switch matches the backend default value `true`
AND saving the reset default sends `enabled: true`
AND the dashboard keeps its defaults local to the client component

#### Scenario: Operator explicitly disables model lockout

GIVEN `modelLockout.enabled` is explicitly `false`
WHEN a timeout response reaches the combo failure path
THEN no model lockout is recorded

#### Scenario: Dashboard preserves explicit opt-out until reset

GIVEN the settings response contains `modelLockout.enabled: false`
WHEN the dashboard renders the setting before Reset defaults is selected
THEN the enabled switch is unchecked
AND Reset defaults changes it to the backend default `true`
AND saving sends `enabled: true`

### Requirement: Record recognized upstream timeout responses without cooling unrelated request failures

When a combo failure is request-scoped, the system SHALL allow model-lockout
recording only for the existing synthetic `combo_target_timeout` or an HTTP
504 whose structured code is `upstream_response_failed`. The existing enabled
setting and configured error-code list SHALL still gate the write. Other
request-scoped failures SHALL NOT record a model lockout.

#### Scenario: Ordinary upstream 504

GIVEN the upstream returns HTTP 504 and the failure is not request-scoped
AND ModelLockout is enabled with 504 in its error-code list
WHEN the combo records the failed target
THEN a model lockout is recorded using the existing exact 5xx scope and
cooldown policy

#### Scenario: Request-scoped upstream response failure is a 504

GIVEN the upstream failure has HTTP status 504 and structured code
`upstream_response_failed`
AND combo classification marks the failure request-scoped
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
