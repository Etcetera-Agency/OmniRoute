## ADDED Requirements

### Requirement: Request validation

The route SHALL read at most 1 MiB plus one byte from the request stream,
independent of `Content-Length`, and SHALL reject a larger body with `413`
without buffering the remainder or calling an upstream. It SHALL reject a
request before any upstream call when the body is not a JSON object, lacks
`state`, has a `state` that is not a string, object, or array, or has a missing
or empty `questions` object. Each question SHALL have `type` equal to
`choice`, `score`, or `noul`. Question `instructions` SHALL be a non-empty
string for all models. When request `model` is exactly
`laya/laya-browser-v19s`, question `instructions` MAY instead be a strict
object containing string `goal` and `rules`, where `rules` is either a string
or an array of strings. Its optional `operation` SHALL be one of `CLICK`,
`TYPE_TEXT`, or `SELECT`. For question IDs matching
`(?:^|_)(click|type_text|select)_target$` case-insensitively, `operation` SHALL
be present and match the captured target operation. Structured instruction
objects SHALL be rejected for all other model values. `choice` and `score`
questions SHALL have `criteria`; the contents of `criteria` SHALL NOT be
validated.

#### Scenario: Existing string instructions remain valid

- **GIVEN** a valid request whose question has a non-empty string `instructions`
- **WHEN** it is posted with any supported model selection
- **THEN** existing validation and dispatch behavior is preserved

#### Scenario: Pinned Browser v19s structured instructions

- **GIVEN** a valid request pinned to `laya/laya-browser-v19s`
- **AND** a target question has matching operation and native string-or-list
  rules
- **WHEN** it is posted
- **THEN** it is dispatched once to Laya with the structured value preserved

#### Scenario: Structured instructions require the pinned Browser model

- **GIVEN** a question has object-valued `instructions`
- **AND** request `model` is omitted, automatic, or names another model
- **WHEN** it is posted
- **THEN** the response is `400` and no upstream is called

#### Scenario: Non-target Browser question may omit operation

- **GIVEN** a request pinned to `laya/laya-browser-v19s`
- **AND** a non-target question has `{ goal, rules }` instructions
- **WHEN** it is posted
- **THEN** the request passes validation

#### Scenario: Target operation must match question ID

- **GIVEN** a request pinned to `laya/laya-browser-v19s`
- **AND** a `click_target` question omits `operation` or names `TYPE_TEXT`
- **WHEN** it is posted
- **THEN** the response is `400` and no upstream is called

#### Scenario: Malformed Browser instruction object

- **GIVEN** a request pinned to `laya/laya-browser-v19s`
- **AND** an instruction object omits `goal` or `rules`, uses a non-string goal
  or invalid rules value, names an unsupported operation, or has an extra field
- **WHEN** it is posted
- **THEN** the response is `400` and no upstream is called
