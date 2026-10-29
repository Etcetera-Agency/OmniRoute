## ADDED Requirements

### Requirement: Exact free-prefix capability identity binding

The capability resolver SHALL bind a model ID beginning with literal `free/`
only when its complete remainder is an exact provider-registry model ID. It
SHALL retain the original provider and model IDs for dispatch.

#### Scenario: Exact raw free ID reuses canonical capabilities

- **GIVEN** a custom provider exposes raw model ID `free/muse-spark-1.3`
- **AND** `muse-spark-1.3` is an exact provider-registry model ID
- **WHEN** native capability resolution evaluates that candidate
- **THEN** it MAY resolve tool, vision, and reasoning fields from unanimous
  exact-ID registry/spec evidence
- **AND** it SHALL return the original custom provider and
  `free/muse-spark-1.3` model ID

#### Scenario: Unknown or prefix-only free ID stays unbound

- **GIVEN** `free/muse-spark-1` is only a partial prefix of multiple canonical IDs,
  or `free/unknown-model` has no exact canonical base
- **WHEN** capability resolution runs
- **THEN** it SHALL NOT strip path segments, follow aliases, or prefix-match
  another model's capabilities
- **AND** the canonical capability fields remain unknown

#### Scenario: Exact ID takes precedence over longer prefix matches

- **GIVEN** `kimi` is an exact provider-registry model ID
- **AND** longer Kimi model IDs also begin with `kimi`
- **WHEN** capability resolution evaluates `free/kimi`
- **THEN** it MAY reuse evidence for the exact `kimi` identity
- **AND** it SHALL NOT select a longer Kimi model by prefix

#### Scenario: Free effort variant requires its own exact anchor

- **GIVEN** `muse-spark-1.3` is an exact provider-registry ID
- **AND** `muse-spark-1.3-high` has no exact provider-registry ID
- **WHEN** capability resolution evaluates `free/muse-spark-1.3-high`
- **THEN** it SHALL NOT inherit capability fields from `muse-spark-1.3`

### Requirement: Exact capability evidence inheritance

The resolver SHALL use existing synced, registry, and static evidence only for
the exact raw ID or, after an exact registry anchor, the exact canonical base.
Direct provider-scoped values and overrides keep precedence; conflicting or
unavailable canonical fields remain unknown. An unanchored free path SHALL NOT
gain capability through leaf, effort-suffix, or model-name heuristic fallback.

#### Scenario: Conflicting canonical fields remain unknown

- **GIVEN** exact registry rows for one canonical ID disagree on a capability
  field or limit
- **WHEN** a free-prefixed ID binds to that canonical ID
- **THEN** that field or limit remains unknown
- **AND** the resolver SHALL NOT choose a provider row by registry order or
  merge conflicting values

#### Scenario: Provider-specific disabled capability wins

- **GIVEN** a custom provider's exact synced row or operator override declares
  tool calling as `false`
- **AND** the canonical identity has tool calling set to `true`
- **WHEN** the free-prefixed candidate is resolved
- **THEN** the provider-specific `false` remains effective

#### Scenario: Unknown path cannot inherit a synced leaf row

- **GIVEN** `free/vendor/muse-spark-1.3` has no exact provider-registry base
- **AND** a synced capability row exists for exact model ID `muse-spark-1.3`
- **WHEN** capability resolution evaluates the nested free ID
- **THEN** it SHALL NOT strip the path to `muse-spark-1.3`
- **AND** it SHALL NOT reuse that synced row

#### Scenario: Unknown vision-family path stays unknown

- **GIVEN** `free/vendor/pixtral-12b` has no exact provider-registry base
- **WHEN** capability resolution evaluates the nested free ID
- **THEN** it SHALL NOT infer vision from the `pixtral` model-name fragment
- **AND** `supportsVision` remains unknown without direct provider evidence

### Requirement: Native identity and candidate pool preservation

Capability inheritance SHALL retain the native raw route identity and SHALL
NOT widen or narrow the prepared candidate pool beyond existing filters.

#### Scenario: Free-prefix binding does not change native pool membership

- **GIVEN** a prepared native pool contains one exact APInex candidate whose
  model ID is `free/muse-spark-1.3`
- **WHEN** the enabled native capability band evaluates it
- **THEN** the candidate retains its original connection and raw model ID
- **AND** no additional provider/model candidates are added
- **AND** non-band routing and capability predicates remain unchanged

#### Scenario: Inherited metadata does not rewrite hidden or connection keys

- **GIVEN** an APInex candidate keeps raw model ID `free/muse-spark-1.3`
- **AND** the exact raw ID is hidden under its provider ID
- **WHEN** native candidate preparation runs
- **THEN** that candidate remains excluded
- **WHEN** only the canonical base ID is hidden under the provider ID
- **THEN** the raw `free/muse-spark-1.3` candidate remains visible
- **AND** attaching canonical capability evidence does not rewrite its raw
  provider/model identity
- **AND** per-connection exclusions matching the full raw path or base name
  narrow only their matching connections from `allowedConnectionIds`
