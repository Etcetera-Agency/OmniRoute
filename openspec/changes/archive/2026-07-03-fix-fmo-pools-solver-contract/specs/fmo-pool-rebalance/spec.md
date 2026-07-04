# fmo-pool-rebalance Specification

## MODIFIED Requirements

### Requirement: Head inventory snapshot

The system SHALL build FMO head candidates from every OmniRoute model source that can
route live chat traffic for an active provider connection. Candidate inventory SHALL
merge connection-scoped `syncedAvailableModels` with provider-scoped `customModels`.
Runtime/manual models stored only in `customModels` SHALL be eligible for FMO head
seating when their provider has an active connection and the provider is not configured
as tail-only. The system SHALL NOT rely on `syncedAvailableModels` alone.

Merged candidates SHALL be deduped by `(providerId, connectionId, modelId)`. When the
same model appears in both sources for a connection, synced metadata SHALL be the base
record and custom metadata MAY fill missing runtime fields such as display name,
`apiFormat`, `supportedEndpoints`, token limits, or explicit vision/thinking flags.
Model compatibility overrides and free-model catalog matching SHALL apply to both
synced and custom candidates. The inventory builder SHALL apply OmniRoute model
visibility gates to every candidate source by using the same hidden-model semantics as
the public model catalog (`getModelIsHidden(providerId, modelId)`, including
`modelCompatOverrides.isHidden` and `customModels.isHidden`). Hidden synced models,
hidden custom models, and malformed custom model rows SHALL NOT be seated as heads.

#### Scenario: Runtime custom model is eligible

- GIVEN provider `local-openai` has an active connection `conn-1`
- AND model `local-openai/my-runtime-model` exists only in provider-scoped `customModels`
- AND `syncedAvailableModels` for `conn-1` is empty
- WHEN FMO head inventory is built
- THEN `my-runtime-model` is included as a head candidate for `(local-openai, conn-1)`
- AND the candidate source identifies that it came from a custom/runtime model source

#### Scenario: Synced and custom model are deduped

- GIVEN provider `openrouter` has active connection `conn-1`
- AND model `openrouter/foo` exists in both `syncedAvailableModels` and `customModels`
- WHEN FMO head inventory is built
- THEN exactly one candidate is produced for `(openrouter, conn-1, openrouter/foo)`
- AND synced metadata is retained with any missing custom metadata filled where safe

#### Scenario: Custom model follows same hard gates

- GIVEN provider `tail-provider` is configured as tail-only
- AND `tail-provider/manual-head` exists in `customModels`
- WHEN FMO head inventory is built
- THEN `manual-head` is not emitted as a head candidate
- AND malformed or hidden custom model rows are skipped

#### Scenario: Hidden synced model is skipped

- GIVEN provider `openrouter` has active connection `conn-1`
- AND model `openrouter/hidden-model` exists in `syncedAvailableModels`
- AND `getModelIsHidden("openrouter", "openrouter/hidden-model")` returns true
- WHEN FMO head inventory is built
- THEN `hidden-model` is not emitted as a head candidate

#### Scenario: Hidden custom model is skipped

- GIVEN provider `local-openai` has active connection `conn-1`
- AND model `local-openai/manual-hidden` exists only in `customModels`
- AND that custom model has `isHidden: true`
- WHEN FMO head inventory is built
- THEN `manual-hidden` is not emitted as a head candidate

### Requirement: Model intelligence band resolution

The system SHALL resolve a candidate's quality against `model_intelligence.score`
for the pool's declared `category`, using the fixed source precedence
`user_override > arena_elo > models_dev_tier`. The accepted pool contract SHALL allow
only categories present in the OmniRoute `model_intelligence` domain:
`coding`, `review`, `planning`, `analysis`, `debugging`, `documentation`, and
`default`. A pool generation with any other category SHALL be rejected at ingestion,
not accepted into a generation that later resolves every candidate to unrated. A
candidate with no resolvable score for the accepted category SHALL NOT be a head
candidate on score grounds. The band metric SHALL be the normalized score in `[0..1]`;
the system SHALL NOT use an Artificial Analysis `intelligence_index`.

#### Scenario: Unknown category rejected

- GIVEN a pool whose `quality_band.category` is `intelligence`
- WHEN the generation is validated
- THEN the generation is rejected as an unsupported model-intelligence category
- AND no pool is stored

#### Scenario: Canonical category resolves

- GIVEN a pool whose `quality_band.category` is `default`
- AND a candidate has a `model_intelligence` row for `default`
- WHEN the band is checked
- THEN the candidate is evaluated against that row's normalized score

### Requirement: Deterministic fill ladder

The system SHALL fill each pool by the deterministic ladder: exact-fit in-band, then
relax the model-intelligence band within `max_delta`, then in-band
higher-capability overflow. The relax step SHALL be symmetric: a candidate whose score
is below `min` or above `max` SHALL be eligible for the relaxed step when it remains
inside `[min - max_delta, max + max_delta]` and passes all hard gates. Step 3
higher-capability overflow SHALL be defined by capability surplus, not by an
intelligence score above the band maximum; score SHALL only order candidates within a
step. The system SHALL relax the band before spending higher-capability overflow and
SHALL NOT relax capability, context, or free gates.

#### Scenario: Above-max candidate can be relaxed

- GIVEN a pool with band `{ min: 0.60, max: 0.80, relax.max_delta: 0.10 }`
- AND an exact-capability candidate with score `0.85`
- AND a higher-capability overflow candidate with score `0.70`
- WHEN the pool is underfilled after exact-fit in-band
- THEN the exact-capability `0.85` candidate is selected in the relaxed-band step
- AND the overflow candidate is not spent first

#### Scenario: Outside relaxed band rejected

- GIVEN a pool with band `{ min: 0.60, max: 0.80, relax.max_delta: 0.10 }`
- AND an exact-capability candidate with score `0.95`
- WHEN the relaxed step runs
- THEN that candidate is not admitted
- AND capability, context, and free gates remain hard gates
