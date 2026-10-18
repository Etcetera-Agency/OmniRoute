## ADDED Requirements

### Requirement: Band channel grammar

A band channel SHALL use `auto/<task>_<band>[_<cap>...][:<tier>]` with supported tasks, bands, capabilities, and upstream tiers. Capabilities are independent and nonrepeating; enabled omitted tier defaults to `thrifty`, disabled omitted tier stays unset.

#### Scenario: Independent fields form a valid channel

- **GIVEN** `auto/coding_low_vision_tools:free` is requested
- **WHEN** The channel is parsed
- **THEN** Its task, band, capabilities, and tier are recognized independently

### Requirement: Parser and pool seams in upstream code

Parsing and candidate filters SHALL stay at the declared suffix-composition seam; band ordering and reserve narrowing SHALL stay at the virtual-factory pool seam, with feature logic in the bands module.

#### Scenario: Band behavior stays behind declared seams

- **GIVEN** A recognized band channel reaches parsing and pool ordering
- **WHEN** The integration runs
- **THEN** The upstream seams delegate band-specific behavior to the bands module

### Requirement: Band-only thrifty order

Enabled band channels at effective `thrifty` tier SHALL prioritize economic rungs in the declared order without excluding otherwise eligible candidates. Ordinary auto channels and explicit non-thrifty tiers retain upstream behavior.

#### Scenario: Rung order changes priority only

- **GIVEN** Eligible band candidates span multiple economic rungs
- **WHEN** An enabled thrifty band channel is ordered
- **THEN** Rungs follow free-to-premium order and eligibility is unchanged

### Requirement: Upstream behavior preserved

IDs that do not match band-channel grammar SHALL retain the unpatched upstream parser and candidate-filter results.

#### Scenario: Ordinary channel keeps upstream behavior

- **GIVEN** An ID does not match the band grammar
- **WHEN** The patched parser and filter receive it
- **THEN** Their results match the upstream functions

### Requirement: Degraded resolution

When enforcement is disabled, a valid band channel SHALL resolve through upstream category precedence (vision, reasoning, coding, then chat), preserving explicit tier and leaving omitted tier unset.

#### Scenario: Disabled channel resolves by precedence

- **GIVEN** A disabled band channel has both vision and reasoning capabilities
- **WHEN** The upstream category is selected
- **THEN** The category is vision and the channel is not rejected as unknown

### Requirement: Channel identity in usage records

Usage records for a band request SHALL keep the full requested channel ID as the combo name in both enforced and degraded modes.

#### Scenario: Degraded request keeps channel identity

- **GIVEN** A band request is handled with enforcement disabled
- **WHEN** Usage is recorded
- **THEN** The combo name equals the full requested ID

### Requirement: Upstream contract tests

Contract tests SHALL pin the task fitness resolver and its source values, virtual-factory acceptance of an opaque category, usage and quota row shapes, and candidate-route acceptance of a band channel.

#### Scenario: Upstream data shapes are pinned

- **GIVEN** The fitness resolver, pool factory, usage/quota accessors, and candidate route are exercised
- **WHEN** The contract suite runs
- **THEN** Their declared inputs, source values, row shapes, and band ID behavior are asserted

### Requirement: Recognize valid band channel syntax

The system SHALL recognize `auto/<task>_<band>[_<cap>...][:<tier>]` as a built-in auto channel. `<task>` SHALL be one of `general`, `coding`. `<band>` SHALL be one of `low`, `mid`, `high`. Each `<cap>` SHALL be one of `tools`, `so`, `reasoning`, `vision`; capabilities MAY appear in any order and SHALL NOT repeat. `<tier>`, when present, SHALL be a tier upstream already accepts.

#### Scenario: Channel with tier

- **WHEN** the requested model is `auto/general_mid:free`
- **THEN** the id is a recognized built-in auto channel with task `general`, band `mid`, no capabilities, tier `free`

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

### Requirement: Keep valid channel components independent and apply the enabled tier default

Task, band, capabilities, and tier SHALL be independent: any valid combination is a valid channel. With `OMNIROUTE_AUTO_BANDS` enabled, a band channel without an explicit tier SHALL use `thrifty`; while disabled, its tier SHALL remain unset for upstream default handling. Any other form SHALL be left to upstream parsing.

#### Scenario: Enabled band channel without tier defaults to thrifty

- **GIVEN** `OMNIROUTE_AUTO_BANDS=1`
- **WHEN** the requested model is `auto/coding_high`
- **THEN** the id is a recognized built-in auto channel with task `coding`, band `high`, no capabilities, and effective tier `thrifty`

### Requirement: Keep parsing, filters, and band ordering behind the declared upstream seams

The feature SHALL modify only `open-sse/services/autoCombo/suffixComposition.ts` for parsing and per-candidate filters, and `open-sse/services/autoCombo/virtualFactory.ts` for band-only pool ordering. The later demand-reserve slice SHALL use the same virtual-factory pool seam for account narrowing. Both seams SHALL delegate feature logic to `open-sse/services/autoCombo/bands/`.

#### Scenario: Seam removed by a sync

- **GIVEN** an upstream sync that drops a hook line from `suffixComposition.ts`
- **WHEN** the unit tests run
- **THEN** the seam test fails

### Requirement: Limit the fork integration delta to declared files and avoid unrelated schema or migration changes

The feature SHALL NOT add numbered migrations or modify `src/sse/handlers/chat.ts`, `featureFlagDefinitions.ts`, `instrumentation-node.ts`, or combo schemas.

#### Scenario: Fork delta has only the two declared integration files

- **WHEN** the branch is diffed against its base upstream tag
- **THEN** the only modified pre-existing files are `suffixComposition.ts` and `virtualFactory.ts`

### Requirement: Order eligible band candidates by economic rung at the effective thrifty tier

When `OMNIROUTE_AUTO_BANDS` is enabled, the system SHALL order eligible candidates for a band channel whose effective tier is `thrifty` by economic rung in this sequence: `free`, `keyless`, `subscription`, `cheap`, `premium`. This ordering SHALL apply only to recognized band channels; ordinary upstream `auto:thrifty` channels SHALL retain upstream ordering.

#### Scenario: Band thrifty order

- **GIVEN** eligible band candidates in all five economic rungs
- **WHEN** a request targets `auto/general_mid` or `auto/general_mid:thrifty`
- **THEN** candidate priority is `free`, `keyless`, `subscription`, `cheap`, `premium`

#### Scenario: Plain upstream thrifty order is unchanged

- **GIVEN** the same candidates and their existing upstream rung order
- **WHEN** a request targets ordinary `auto:thrifty`
- **THEN** the candidate order equals the unmodified upstream order

### Requirement: Apply rung ordering as priority while preserving upstream eligibility

The ordering SHALL affect priority only and SHALL NOT itself exclude candidates by quality or economic rung. Existing tier eligibility, account availability, quota, budget, zero-cost, and other upstream filters SHALL continue to determine which candidates are eligible. An explicit band-channel tier other than `thrifty` SHALL retain that tier's upstream behavior.

#### Scenario: Explicit free tier retains upstream eligibility

- **WHEN** a request targets `auto/general_mid:free`
- **THEN** the upstream free-tier eligibility applies and the band thrifty rung order is not applied

#### Scenario: Disabled feature keeps upstream order and tier default

- **GIVEN** `OMNIROUTE_AUTO_BANDS` is unset and no tier was requested
- **WHEN** the request targets `auto/general_mid`
- **THEN** degraded category mapping is used, the tier stays unset for upstream default handling, and no band-specific rung order applies

### Requirement: Preserve upstream handling for non-band channels

For every ID that does not match the band grammar, the feature SHALL call the upstream functions with the unchanged ID and preserve upstream filters and behavior.

#### Scenario: Upstream ids unchanged

- **WHEN** `coding`, `coding:fast`, `vision`, `reasoning:pro`, `bogus`, and `a:b:c` are parsed
- **THEN** each result equals the unpatched upstream result

#### Scenario: Upstream filters unchanged

- **WHEN** a candidate filter is built for category `vision` and tier `free`
- **THEN** it accepts and rejects the same candidates as the unpatched upstream filter

### Requirement: Resolve disabled band channels to the upstream category precedence

While band enforcement is disabled, a band channel SHALL resolve to an upstream category: category `vision` when the channel carries the `vision` capability, otherwise category `reasoning` when the channel carries the `reasoning` capability, otherwise category `coding` for task `coding`, otherwise category `chat`.

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

### Requirement: Preserve upstream tier defaults when enforcement is disabled

An explicit tier SHALL be preserved; an omitted tier SHALL remain unset so upstream supplies its default. Enforcement SHALL be disabled unless `OMNIROUTE_AUTO_BANDS` is `1` or `true`. A band channel SHALL NOT be rejected as an unknown model because enforcement is disabled.

#### Scenario: Disabled by default

- **GIVEN** `OMNIROUTE_AUTO_BANDS` is unset
- **WHEN** the requested model is `auto/general_mid:free`
- **THEN** the request routes with category `chat` and explicit tier `free`

### Requirement: Keep the original band channel as combo identity in usage records

Usage records SHALL retain the original channel ID as the combo name so band demand can be grouped from recorded usage.

#### Scenario: Combo name is the channel id

- **WHEN** a request to `auto/general_mid:free` completes
- **THEN** its usage record has combo name `auto/general_mid:free`

### Requirement: Keep upstream contract tests for fitness resolution and candidate routing

The implementation SHALL retain upstream contract tests for the task fitness resolver and its source values, the virtual combo factory accepting an opaque category, usage-row and quota-snapshot row shapes, and the candidates route accepting a band channel.

#### Scenario: Fitness resolver contract

- **WHEN** the fitness resolver is called for an unknown model
- **THEN** it returns a numeric score and a source that starts with `wildcard_boost`

#### Scenario: Candidates route contract

- **WHEN** `GET /v1/auto-combo/general_mid:free/candidates` is called with a valid key
- **THEN** the response status is 200
