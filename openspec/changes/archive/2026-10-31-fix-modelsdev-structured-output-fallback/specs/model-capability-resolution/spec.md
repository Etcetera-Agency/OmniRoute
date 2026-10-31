## ADDED Requirements

### Requirement: Preserve native structured-output capability

When the requested provider, connection, and model has a native
structured-output boolean, the shared resolver SHALL return that value without
changing it based on other providers' model rows.

#### Scenario: Native false vetoes cross-provider true

- **GIVEN** the requested provider's exact native model row declares
  `structured_output=false`
- **AND** another provider's row for the same canonical model ID declares
  `structured_output=true`
- **WHEN** the shared capability resolver resolves the requested model
- **THEN** it returns `false`

#### Scenario: Native true remains authoritative

- **GIVEN** the requested provider's exact native model row declares
  `structured_output=true`
- **AND** other provider rows for the same canonical model ID declare
  `false`, `null`, or omit the field
- **WHEN** the shared capability resolver resolves the requested model
- **THEN** it returns `true`

#### Scenario: Native true remains authoritative

- **GIVEN** the requested provider's exact native model row declares
  `structured_output=true`
- **AND** other provider rows may declare `false`, `null`, or omit the field
- **WHEN** the shared capability resolver resolves the requested model
- **THEN** it returns `true` independent of provider row order

### Requirement: Use exact models.dev structured-output fallback

When native structured output is absent, the resolver SHALL return `true` if
any models.dev row has the same canonical model ID and explicitly declares
`structured_output=true`. Other rows SHALL NOT veto that evidence. Without an
exact true row, the resolver SHALL return `null`. `tool_call` SHALL NOT count as
structured-output evidence.

#### Scenario: Any exact cross-provider true supplies absent native value

- **GIVEN** the requested provider has no native structured-output boolean
- **AND** one models.dev row for the same canonical model ID declares
  `structured_output=true`
- **AND** other provider rows may declare `false`, `null`, or omit the field
- **WHEN** the shared capability resolver resolves the requested model
- **THEN** it returns `true` independent of provider row order

#### Scenario: False-only and missing rows remain unknown

- **GIVEN** the requested provider has no native structured-output boolean
- **AND** all exact cross-provider rows declare `false`, `null`, or omit the
  field, or no exact row exists
- **WHEN** the shared capability resolver resolves the requested model
- **THEN** it returns `null`
- **AND** existing structured-output band policy continues to deny the unknown
  capability

#### Scenario: Tool calling does not establish structured output

- **GIVEN** an exact models.dev row declares `tool_call=true` but has no
  `structured_output=true`
- **WHEN** the shared capability resolver resolves the model
- **THEN** it does not report structured output as supported

#### Scenario: Exact canonical ID and recognized free prefix

- **GIVEN** models.dev declares `structured_output=true` for one canonical
  model ID
- **WHEN** the resolver receives that exact ID or a `free/<model>` ID whose
  base is recognized by the existing exact free-prefix helper
- **THEN** it may use the row for that same canonical ID
- **AND** it does not inherit from a similar or prefix-matching model ID
- **AND** a free-prefixed native row does not become native evidence for the
  unprefixed base model
