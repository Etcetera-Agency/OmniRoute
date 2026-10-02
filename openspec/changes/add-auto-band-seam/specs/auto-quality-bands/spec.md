## ADDED Requirements

### Requirement: Band channel grammar

The system SHALL recognize `auto/<task>_<band>[_<cap>...][:<tier>]` as a
built-in auto channel. `<task>` SHALL be one of `general`, `coding`. `<band>`
SHALL be one of
`low`, `mid`, `high`. Each `<cap>` SHALL be one of `tools`, `so`, `reasoning`,
`vision`;
capabilities MAY appear in any order and SHALL NOT repeat. `<tier>`, when
present, SHALL be a tier upstream already accepts. Task, band, capabilities, and
tier SHALL be independent: any valid combination is a valid channel. With
`OMNIROUTE_AUTO_BANDS` enabled, a band channel without an explicit tier SHALL
use `thrifty`; while disabled, its tier SHALL remain unset for upstream default
handling. Any other form SHALL be left to upstream parsing.

#### Scenario: Channel with tier

- **WHEN** the requested model is `auto/general_mid:free`
- **THEN** the id is a recognized built-in auto channel with task `general`, band `mid`, no capabilities, tier `free`

#### Scenario: Enabled band channel without tier defaults to thrifty

- **GIVEN** `OMNIROUTE_AUTO_BANDS=1`
- **WHEN** the requested model is `auto/coding_high`
- **THEN** the id is a recognized built-in auto channel with task `coding`, band `high`, no capabilities, and effective tier `thrifty`

#### Scenario: Channel with one capability

- **WHEN** the requested model is `auto/general_high_tools:free`
- **THEN** the id is recognized with task `general`, band `high`, capability `tools`, tier `free`

#### Scenario: Capability order does not matter

- **WHEN** the requested models are `auto/general_low_tools_so` and `auto/general_low_so_tools`
- **THEN** both are recognized with the same task, band, and capability set `{tools, so}`

#### Scenario: Repeated capability

- **WHEN** the requested model is `auto/general_low_tools_tools`
- **THEN** the band grammar does not match and upstream parsing decides the result

#### Scenario: Unknown band

- **WHEN** the requested model is `auto/coding_ultra`
- **THEN** the band grammar does not match and upstream parsing decides the result

#### Scenario: Unknown tier

- **WHEN** the requested model is `auto/coding_high:bogus`
- **THEN** the id is not a valid auto channel

### Requirement: Parser and pool seams in upstream code

The feature SHALL modify only `open-sse/services/autoCombo/suffixComposition.ts`
for parsing and per-candidate filters, and
`open-sse/services/autoCombo/virtualFactory.ts` for band-only pool ordering.
The later demand-reserve slice SHALL use the same virtual-factory pool seam for
account narrowing. Both seams SHALL delegate feature logic to
`open-sse/services/autoCombo/bands/`. The feature SHALL NOT add numbered
migrations or modify `src/sse/handlers/chat.ts`, `featureFlagDefinitions.ts`,
`instrumentation-node.ts`, or combo schemas.

#### Scenario: Seam removed by a sync

- **GIVEN** an upstream sync that drops a hook line from `suffixComposition.ts`
- **WHEN** the unit tests run
- **THEN** the seam test fails

#### Scenario: Fork delta has only the two declared integration files

- **WHEN** the branch is diffed against its base upstream tag
- **THEN** the only modified pre-existing files are `suffixComposition.ts` and `virtualFactory.ts`

### Requirement: Band-only thrifty order

When `OMNIROUTE_AUTO_BANDS` is enabled, the system SHALL order eligible
candidates for a band channel whose effective tier is `thrifty` by economic
rung in this sequence: `free`, `keyless`, `subscription`, `cheap`,
`premium`. This ordering SHALL apply only to recognized band channels; ordinary
upstream `auto:thrifty` channels SHALL retain upstream ordering. The ordering
SHALL affect priority only and SHALL NOT itself exclude candidates by quality
or economic rung. Existing tier eligibility, account availability, quota,
budget, zero-cost, and other upstream filters SHALL continue to determine which
candidates are eligible. An explicit band-channel tier other than `thrifty`
SHALL retain that tier's upstream behavior.

#### Scenario: Band thrifty order

- **GIVEN** eligible band candidates in all five economic rungs
- **WHEN** a request targets `auto/general_mid` or `auto/general_mid:thrifty`
- **THEN** candidate priority is `free`, `keyless`, `subscription`, `cheap`, `premium`

#### Scenario: Plain upstream thrifty order is unchanged

- **GIVEN** the same candidates and their existing upstream rung order
- **WHEN** a request targets ordinary `auto:thrifty`
- **THEN** the candidate order equals the unmodified upstream order

#### Scenario: Explicit free tier retains upstream eligibility

- **WHEN** a request targets `auto/general_mid:free`
- **THEN** the upstream free-tier eligibility applies and the band thrifty rung order is not applied

#### Scenario: Disabled feature keeps upstream order and tier default

- **GIVEN** `OMNIROUTE_AUTO_BANDS` is unset and no tier was requested
- **WHEN** the request targets `auto/general_mid`
- **THEN** degraded category mapping is used, the tier stays unset for upstream default handling, and no band-specific rung order applies

### Requirement: Upstream behavior preserved

The parser and candidate filter SHALL return the same results as the unpatched
upstream functions for every id that does not match the band grammar.

#### Scenario: Upstream ids unchanged

- **WHEN** `coding`, `coding:fast`, `vision`, `reasoning:pro`, `bogus`, and `a:b:c` are parsed
- **THEN** each result equals the unpatched upstream result

#### Scenario: Upstream filters unchanged

- **WHEN** a candidate filter is built for category `vision` and tier `free`
- **THEN** it accepts and rejects the same candidates as the unpatched upstream filter

### Requirement: Degraded resolution

While band enforcement is disabled, a band channel SHALL resolve to an upstream
category: category `vision` when the channel carries
the `vision` capability, otherwise category `reasoning` when it carries the
`reasoning` capability, otherwise category `coding` for task `coding`,
otherwise category `chat`. An explicit tier SHALL be preserved; an omitted tier
SHALL remain unset so upstream supplies its default. Enforcement SHALL be disabled unless
`OMNIROUTE_AUTO_BANDS` is `1` or `true`. A band channel SHALL NOT be rejected as
an unknown model because enforcement is disabled.

#### Scenario: Disabled by default

- **GIVEN** `OMNIROUTE_AUTO_BANDS` is unset
- **WHEN** the requested model is `auto/general_mid:free`
- **THEN** the request routes with category `chat` and explicit tier `free`

#### Scenario: Vision capability keeps the vision category

- **GIVEN** `OMNIROUTE_AUTO_BANDS` is unset
- **WHEN** the requested model is `auto/general_low_vision:free`
- **THEN** the request routes with category `vision` and tier `free`

#### Scenario: Reasoning capability keeps the reasoning category

- **GIVEN** `OMNIROUTE_AUTO_BANDS` is unset
- **WHEN** the requested model is `auto/general_high_reasoning:free`
- **THEN** the request routes with category `reasoning` and tier `free`

#### Scenario: Coding keeps its category

- **GIVEN** `OMNIROUTE_AUTO_BANDS` is unset
- **WHEN** the requested model is `auto/coding_high:thrifty`
- **THEN** the request routes with category `coding` and tier `thrifty`

### Requirement: Channel identity in usage records

A request to a band channel SHALL be recorded with a combo name equal to the
full requested id, in both degraded and enforced modes.

#### Scenario: Combo name is the channel id

- **WHEN** a request to `auto/general_mid:free` completes
- **THEN** its usage record has combo name `auto/general_mid:free`

### Requirement: Upstream contract tests

The test suite SHALL pin every upstream interface the bands module consumes:
the task fitness resolver and its source values, the virtual combo factory
accepting an opaque category, the usage-row and quota-snapshot row shapes, and
the candidates route accepting a band channel.

#### Scenario: Fitness resolver contract

- **WHEN** the fitness resolver is called for an unknown model
- **THEN** it returns a numeric score and a source that starts with `wildcard_boost`

#### Scenario: Candidates route contract

- **WHEN** `GET /v1/auto-combo/general_mid:free/candidates` is called with a valid key
- **THEN** the response status is 200
