## ADDED Requirements

### Requirement: Strict evidence lifetime and exact identity

The strict filter SHALL accept an uncatalogued candidate only with exact
provider/model evidence, a valid non-future source timestamp, and a model other
than dynamic `openrouter/free`. Snapshot age alone SHALL NOT expire evidence.

#### Scenario: Exact stale source evidence remains usable

GIVEN exact zero input/output models.dev evidence and `structured_output`
enabled
AND its valid `fetchedAt` is more than 36 hours old
WHEN the exact uncatalogued candidate is classified
THEN source evidence qualifies and its timestamp remains unchanged

#### Scenario: Dynamic OpenRouter free model stays excluded

GIVEN evidence contains `openrouter/free`
WHEN strict classification checks that dynamic route
THEN the candidate remains excluded

### Requirement: Native import mapping and effective pricing

The importer SHALL use `mapProviderId()`. The last raw provider entry mapped
to a canonical provider owns that provider's evidence model set. Evidence for
its exact IDs SHALL require explicit numeric zero for every raw price and
effective zero input/output prices from `transformModelsDevToPricing`.

#### Scenario: Raw provider key maps to routing identity

GIVEN models.dev publishes an exact zero-price ID under raw provider `kilo`
WHEN the importer extracts zero-price evidence
THEN the exact ID is keyed under `kilocode` and aliases from `mapProviderId()`

#### Scenario: Alias collision follows final provider ownership and pricing

GIVEN raw provider `kilo` publishes exact zero-price IDs
AND later raw provider `kilocode` maps to the same canonical provider
AND the later entry prices one shared ID nonzero, another shared ID at exact
zero, and omits a third earlier ID
WHEN native pricing and zero-price evidence are transformed
THEN the nonzero ID is excluded, the final effective zero ID is included, and
the earlier-only ID is absent

#### Scenario: Exact model identity and explicit zero prices are required

GIVEN zero-price evidence contains a specific raw model ID
WHEN evidence is absent, another ID is requested, or any raw price is missing
or nonzero
THEN the candidate receives no source-evidence qualification

### Requirement: Compatible pricing source consensus has no age expiry

Compatible pricing SHALL retain exact active eligible connection/model
membership, complete input/output prices for every eligible connection, and
price consensus. Valid non-future snapshots SHALL NOT expire solely by age;
original timestamps SHALL remain provenance. This rule SHALL NOT alter
capability false-veto or unknown behavior.

#### Scenario: Old complete compatible zero-price consensus remains evidence

GIVEN every active eligible connection exposes the exact model ID with
complete, consistent numeric zero input and output prices
AND a compatible pricing snapshot is older than 36 hours
WHEN compatible pricing evidence is composed
THEN the exact provider/model remains in zero-price evidence
AND the original oldest `fetchedAt` is retained

#### Scenario: Compatible pricing completeness and consensus remain required

GIVEN an exact model is missing from an eligible connection, lacks input or
output price, has a nonzero price, or conflicts across eligible connections
WHEN compatible pricing evidence is composed
THEN the model is excluded from zero-price evidence

#### Scenario: Compatible capability false and unknown behavior is unchanged

GIVEN a compatible capability snapshot reports explicit `false` or omits the
capability for an eligible model
WHEN the capability override is resolved
THEN explicit `false` vetoes and unknown remains `null`

### Requirement: Static catalog safety remains authoritative

Candidates in `FreeModelBudget` SHALL continue through existing free-access,
hard-stop, and per-connection quota checks. Source evidence SHALL NOT bypass
those checks or change upstream strict-zero policy.

#### Scenario: Static catalog quota and hard-stop rules remain unchanged

GIVEN a static catalog entry requires a hard stop and quota state
WHEN its hard stop is absent, quota is unknown, or allowance is exhausted
THEN the candidate remains excluded under existing catalog rules
