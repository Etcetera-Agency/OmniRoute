## MODIFIED Requirements

### Requirement: Request validation

The route SHALL read at most 1 MiB plus one byte from the request stream,
independent of `Content-Length`, and SHALL reject a larger body with `413`
without buffering the remainder or calling an upstream. It SHALL reject a
request before any upstream call when the body is not a JSON object, lacks
`state`, has a `state` that is not a string, object, or array, or has a missing
or empty `questions` object. Each question SHALL have `type` equal to `choice`,
`score`, or `noul`. Question `instructions` SHALL be a non-empty string for all
models. When request `model` is exactly `laya/laya-browser-v19s`, question
`instructions` MAY instead be a strict object containing string `goal` and
`rules`, where `rules` is either a string or an array of strings. Its optional
`operation` SHALL be one of `CLICK`, `TYPE_TEXT`, or `SELECT`. For question IDs
matching `(?:^|_)(click|type_text|select)_target$` case-insensitively,
`operation` SHALL be present and match the captured target operation.
Structured instruction objects SHALL be rejected for all other model values.
`choice` and `score` questions SHALL have `criteria`. The contents of `criteria`
SHALL NOT be validated.

The request MAY include `max_len` and `head_max_len`. Each supplied value SHALL
be a positive safe integer JSON number; booleans, fractions, zero, negative
values, strings, and null SHALL return HTTP 400 with an error naming the
field. If `head_max_len` is supplied, `max_len` SHALL also be supplied, and
`head_max_len` SHALL be less than or equal to `max_len`. `max_len` SHALL be
less than or equal to the effective `LAYA_MAX_TOKEN_BUDGET` read by OmniRoute;
when that variable is unset or invalid, the effective ceiling SHALL be `8192`.
Budget validation SHALL happen before API-key policy and upstream dispatch.

#### Scenario: Valid request

- **GIVEN** a body with a string `state` and one `noul` question with `instructions`
- **WHEN** it is posted
- **THEN** it is dispatched to an upstream

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

#### Scenario: Unknown question type

- **GIVEN** a question with `type` `rank`
- **WHEN** the request is posted
- **THEN** the response is `400`, names the question, and no upstream is called

#### Scenario: Body too large

- **GIVEN** a body larger than 1 MiB, including one with missing or inaccurate `Content-Length`
- **WHEN** it is posted
- **THEN** the response is `413`, the unread remainder is not buffered, and no upstream is called

#### Scenario: Invalid token budget

- **GIVEN** either budget field is boolean, fractional, zero, negative, null, or a string
- **WHEN** the request is posted
- **THEN** the response is `400`, names the invalid field, and no upstream is called

#### Scenario: Head budget without total budget

- **GIVEN** a request with `head_max_len` but no `max_len`
- **WHEN** it is posted
- **THEN** the response is `400` explaining that `head_max_len` requires `max_len`
- **AND** API-key policy and upstream dispatch are not called

#### Scenario: Head budget exceeds total budget

- **GIVEN** a request with `max_len` 512 and `head_max_len` 513
- **WHEN** it is posted
- **THEN** the response is `400` naming the relationship and no upstream is called

#### Scenario: Configured ceiling

- **GIVEN** OmniRoute's `LAYA_MAX_TOKEN_BUDGET` is `4096`
- **WHEN** a request supplies `max_len` `4097`
- **THEN** the response is `400` before API-key policy or dispatch

#### Scenario: Default ceiling

- **GIVEN** `LAYA_MAX_TOKEN_BUDGET` is unset or invalid
- **WHEN** a request supplies `max_len` `8192`
- **THEN** budget validation passes
- **AND** a request with `max_len` `8193` receives `400`

### Requirement: Upstream chain

The route SHALL dispatch to upstreams `laya`, `typesafe`, and `openrouter`. An
upstream SHALL take part only when configured: `laya` by
`OMNIROUTE_SYSTEMONE_LAYA_URL`, `typesafe` by
`OMNIROUTE_SYSTEMONE_TYPESAFE_API_KEY`, `openrouter` by
`OMNIROUTE_SYSTEMONE_OPENROUTER_API_KEY`. The order SHALL be
`laya, typesafe, openrouter` unless `OMNIROUTE_SYSTEMONE_ORDER` sets another.
Unknown names SHALL be ignored. Duplicate names SHALL be removed stably,
keeping the first occurrence. The route SHALL forward only `state`,
`questions`, and the rewritten `model`, except that supplied `max_len` and
`head_max_len` SHALL be forwarded unchanged only when the request model
explicitly pins Laya (`laya` or `laya/<checkpoint>`). Chain, TypeSafe, and
OpenRouter requests SHALL omit both budget fields. When both fields are
absent, the serialized outgoing request body SHALL be byte-identical to the
pre-change body.

#### Scenario: Laya first

- **GIVEN** `laya` and `typesafe` are configured with the default order
- **WHEN** a request without `model` is posted and Laya answers `200`
- **THEN** Laya's answer is returned and TypeSafe is not called

#### Scenario: Custom order

- **GIVEN** `OMNIROUTE_SYSTEMONE_ORDER=typesafe,laya`
- **WHEN** a request without `model` is posted
- **THEN** TypeSafe is called first

#### Scenario: Order ignores unknown names and keeps first duplicate

- **GIVEN** `OMNIROUTE_SYSTEMONE_ORDER=typesafe,unknown,laya,typesafe`
- **WHEN** a chain-mode request is posted
- **THEN** the effective order is `typesafe,laya`, with TypeSafe attempted once

#### Scenario: Pinned Laya receives token budgets

- **GIVEN** a valid request with `model` `laya/multilingual`, `max_len` `4096`, and `head_max_len` `512`
- **WHEN** it is posted
- **THEN** only Laya is called and both values are forwarded unchanged

#### Scenario: Unpinned chain omits token budgets

- **GIVEN** a valid chain-mode request with `max_len` `4096` and `head_max_len` `512`
- **WHEN** the request is posted
- **THEN** every attempted upstream body omits both fields, including a Laya attempt

#### Scenario: Other pinned upstreams omit token budgets

- **GIVEN** a valid request with both budget fields and a pinned TypeSafe or OpenRouter model
- **WHEN** it is posted
- **THEN** the selected upstream body omits both fields

#### Scenario: Omitted budgets preserve body bytes

- **GIVEN** a valid pinned Laya request with neither budget field
- **WHEN** it is posted
- **THEN** the serialized Laya request body is byte-identical to the pre-change body
