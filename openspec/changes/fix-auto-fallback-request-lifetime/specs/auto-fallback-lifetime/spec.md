## ADDED Requirements

### Requirement: Auto candidate first attempts are protected by bounded budget

For Auto and virtual Auto bands, every still-eligible candidate SHALL receive
one first dispatch in existing order. Configured and hard attempt caps SHALL
bound repeats only. The existing total-dispatch counter SHALL continue to count
actual dispatches and SHALL NOT be repurposed as the repeat-only counter.
Non-Auto accounting SHALL remain unchanged.

#### Scenario: Retries leave budget for later Auto candidates

GIVEN Auto has 32 unique eligible candidates
AND `maxRetries` is zero and `maxGlobalAttempts` is 30
WHEN the last dispatched candidate succeeds
THEN all 32 candidates were dispatched once
AND the final success response is returned.

#### Scenario: Candidate pool exceeds bounded attempt ceiling

GIVEN Auto's finite eligible pool exceeds the hard attempt cap
WHEN all first attempts fail
THEN every eligible candidate receives one first dispatch
AND no repeat is dispatched beyond the hard repeat cap.

#### Scenario: Retries cannot displace untouched first attempts

GIVEN Auto has more eligible candidates than a small configured repeat cap
AND an early target qualifies for retries
WHEN the candidate loop runs
THEN every candidate receives its first dispatch
AND any dispatched retries stay within the configured cap.

#### Scenario: Non-Auto attempt budget retains existing behavior

GIVEN a Non-Auto combo has the same targets, retry settings, and attempt cap
WHEN an early target retries
THEN the existing Non-Auto shared attempt accounting is preserved.

#### Scenario: Whole-set retries retain first-pass aggregate outcomes

GIVEN Auto exhausts a small finite candidate pool and has a one-repeat budget
WHEN a whole-set retry dispatches one already-attempted candidate and skips the
remaining repeats after budget exhaustion
THEN every first-pass model identity and HTTP status remains in the final
aggregate
AND the actual total-dispatch count includes the repeat but not skipped work.

### Requirement: Auto has no implicit request-global deadline

Auto and virtual Auto bands SHALL have no implicit request-global ten-minute
cutoff when `comboTimeoutMs` is missing or nonpositive. Each target SHALL retain
a finite deadline. A positive explicit `comboTimeoutMs` SHALL remain the global
deadline; Non-Auto lifetime behavior SHALL remain unchanged.

#### Scenario: Auto passes ten minutes of accumulated target time

GIVEN Auto has more than one eligible target and no positive `comboTimeoutMs`
WHEN successive finite target attempts accumulate more than ten minutes and a
later target succeeds
THEN the request continues through the later target and returns its success.

#### Scenario: Auto disabled target timeout uses finite safety bound

GIVEN Auto resolves a disabled or nonpositive effective target timeout
WHEN that target is dispatched
THEN it uses the existing resolved combo target timeout
AND the existing cooldown-wait floor is preserved (310,000 ms with the current
300,000 ms default wait budget and 10,000 ms dispatch buffer)
AND no new setting or unbounded target wait is introduced.

#### Scenario: Explicit positive Auto deadline remains effective

GIVEN Auto has a positive `comboTimeoutMs`
WHEN the request-global duration expires before another target dispatch
THEN the loop stops at that explicit deadline and returns the existing timeout
aggregate.

#### Scenario: Client cancellation stops Auto dispatch

GIVEN the client aborts the real request signal during a target attempt
WHEN the attempt resolves or rejects
THEN the loop dispatches no later target and returns the existing cancellation
response.

### Requirement: Model-scoped transient errors do not terminate heterogeneous Auto

The system SHALL keep model-scoped transient failures local to the failed Auto
candidate and SHALL continue through remaining heterogeneous eligible models.
Three identical model error signatures alone SHALL NOT be treated as proof that
other eligible models reject the request. Proven request-global invalid or
cancellation errors MAY stop dispatch.

#### Scenario: Three identical model-classified temporary errors precede heterogeneous success

GIVEN at least four heterogeneous eligible Auto candidates
WHEN the first three return identical model-scoped transient errors
AND the fourth succeeds
THEN the fourth candidate is dispatched
AND its success response is returned.

#### Scenario: Proven request-global invalid response stops dispatch

GIVEN Auto has a remaining heterogeneous candidate
WHEN a target returns an error classified as request-global invalid input
THEN no later candidate is dispatched
AND the existing invalid response is returned.

### Requirement: Auto dispatches an uncooled same-model sibling after upstream 504

After a connection returns `upstream_response_failed` with HTTP 504, Auto SHALL
dispatch an eligible sibling connection for the same raw model when the sibling
has no cooldown. This requirement specifies routing behavior and does not
require a particular internal failure classification.

#### Scenario: Upstream 504 leaves same-model sibling connection eligible

GIVEN one raw model is eligible on two allowed connections
AND the sibling connection has no cooldown
WHEN the first connection returns `upstream_response_failed` with HTTP 504
THEN the same raw model on the sibling connection remains eligible and is
dispatched
AND a sibling success is returned.

#### Scenario: Success stops further dispatch

GIVEN Auto has later eligible candidates
WHEN a candidate returns success
THEN no later candidate is dispatched
AND that candidate's response is returned.

### Requirement: Auto failure aggregation preserves candidate identity and status

When every Auto target fails, the system SHALL return its existing aggregate
failure response with each attempted model identity and observed HTTP status
represented in diagnostic output. A failed target SHALL NOT erase prior target
outcomes.

#### Scenario: All candidates fail with distinct statuses

GIVEN multiple eligible Auto candidates return different non-success statuses
WHEN the candidate pass is exhausted
THEN the aggregate retains the attempted model identities and their statuses.

#### Scenario: Upstream 504 falls through to later success for non-streaming chat

GIVEN a non-streaming request and at least two eligible candidates
WHEN the first candidate returns HTTP 504 and a later candidate returns success
THEN the later candidate is dispatched
AND the final response body is the later candidate's success body.

#### Scenario: Per-target timeout abort is isolated

GIVEN a target reaches its finite per-target timeout
WHEN its target-local abort signal fires
THEN the timed-out target is aborted
AND that local abort does not abort the next eligible candidate.
