## ADDED Requirements

### Requirement: Route switch

`POST /v1/systemone` SHALL be served only when `OMNIROUTE_SYSTEMONE` is `1` or
`true`. Otherwise it SHALL return the same `404` JSON error as an unknown
`/v1/*` path, with `error.type` `not_found` and `error.code` `unknown_route`.

#### Scenario: Flag off

- **GIVEN** `OMNIROUTE_SYSTEMONE` is unset
- **WHEN** a client posts a valid request to `/v1/systemone`
- **THEN** the response is `404` with `error.code` `unknown_route` and no upstream is called

#### Scenario: Flag on without upstreams

- **GIVEN** `OMNIROUTE_SYSTEMONE=1` and no upstream variable is set
- **WHEN** a client posts a valid request
- **THEN** the response is `503` and names the variables that configure an upstream

### Requirement: CORS preflight

`OPTIONS /v1/systemone` SHALL return the standard OmniRoute CORS preflight
response without reading a request body or calling an upstream, regardless of
whether `OMNIROUTE_SYSTEMONE` is enabled.

#### Scenario: Preflight does not dispatch

- **GIVEN** any value of `OMNIROUTE_SYSTEMONE`
- **WHEN** a client sends `OPTIONS /v1/systemone`
- **THEN** the standard CORS response is returned and no upstream is called

### Requirement: Request validation

The route SHALL read at most 1 MiB plus one byte from the request stream,
independent of `Content-Length`, and SHALL reject a larger body with `413`
without buffering the remainder or calling an upstream. It SHALL reject a
request before any upstream call when the body is not a JSON object, lacks
`state`, has a `state` that is not a string, object, or array, or has a missing
or empty `questions` object. Each
question SHALL have `type` equal to `choice`, `score`, or `noul` and a
non-empty string `instructions`; `choice` and `score` questions SHALL have
`criteria`. The contents of `criteria` SHALL NOT be validated.

#### Scenario: Valid request

- **GIVEN** a body with a string `state` and one `noul` question with `instructions`
- **WHEN** it is posted
- **THEN** it is dispatched to an upstream

#### Scenario: Unknown question type

- **GIVEN** a question with `type` `rank`
- **WHEN** the request is posted
- **THEN** the response is `400`, names the question, and no upstream is called

#### Scenario: Body too large

- **GIVEN** a body larger than 1 MiB, including one with missing or inaccurate `Content-Length`
- **WHEN** it is posted
- **THEN** the response is `413`, the unread remainder is not buffered, and no upstream is called

### Requirement: Upstream chain

The route SHALL dispatch to upstreams `laya`, `typesafe`, and `openrouter`. An
upstream SHALL take part only when configured: `laya` by
`OMNIROUTE_SYSTEMONE_LAYA_URL`, `typesafe` by
`OMNIROUTE_SYSTEMONE_TYPESAFE_API_KEY`, `openrouter` by
`OMNIROUTE_SYSTEMONE_OPENROUTER_API_KEY`. The order SHALL be
`laya, typesafe, openrouter` unless `OMNIROUTE_SYSTEMONE_ORDER` sets another.
Unknown names SHALL be ignored. Duplicate names SHALL be removed stably,
keeping the first occurrence.
Only `state`, `questions`, and the rewritten `model` SHALL be forwarded.

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

### Requirement: Model selection and rewrite

The route SHALL use the configured chain when request `model` is omitted,
`auto`, `systemone/auto`, or starts with `jev-`. `laya` and `laya/<checkpoint>`,
`typesafe/<id>`, and `openrouter/<id>` SHALL pin that single upstream. Any
other value, or a pinned upstream that is not configured, SHALL return `400`
listing the accepted forms.

The `model` sent upstream SHALL be: for `laya`, the pinned checkpoint, else
`OMNIROUTE_SYSTEMONE_LAYA_MODEL`, else omitted; for `typesafe`, the pinned id,
else the caller's `jev-…` value, else `OMNIROUTE_SYSTEMONE_TYPESAFE_MODEL`
(default `jev-latest`); for `openrouter`, the pinned id, else
`OMNIROUTE_SYSTEMONE_OPENROUTER_MODEL` (default `typesafe/jev-1.13`).

#### Scenario: Jev tool against Laya

- **GIVEN** only `laya` is configured with no checkpoint set
- **WHEN** a request with `model` `jev-latest` is posted
- **THEN** the request sent to Laya has no `model` field

#### Scenario: Pinned checkpoint

- **GIVEN** `laya` and `typesafe` are configured
- **WHEN** a request with `model` `laya/multilingual` is posted
- **THEN** only Laya is called, with `model` `multilingual`

#### Scenario: Pinned upstream not configured

- **GIVEN** only `laya` is configured
- **WHEN** a request with `model` `typesafe/jev-latest` is posted
- **THEN** the response is `400` and no upstream is called

### Requirement: Fallback and cooldown

In chain mode the route SHALL try the next upstream after a network error, a
timeout (`OMNIROUTE_SYSTEMONE_TIMEOUT_MS`, default `5000`), a `5xx`, a `429`, a
`401`, or a `403`, and SHALL place the failed upstream in cooldown for
`OMNIROUTE_SYSTEMONE_COOLDOWN_MS` (default `30000`). For `429` with
`Retry-After`, the cooldown SHALL be that value, capped at four times the
configured cooldown. A `413` or `422` from `laya` SHALL lead to the next
upstream without cooldown. Any other `4xx` SHALL be returned to the caller
without further attempts.

An upstream in cooldown SHALL be skipped; when all configured upstreams are in
cooldown, the one whose cooldown ends first SHALL be tried. In pinned mode
there SHALL be exactly one attempt; an upstream HTTP failure SHALL retain its
HTTP status and return an OmniRoute JSON error envelope containing a sanitized
short cause. A non-JSON or unreadable upstream error body SHALL use the same
envelope and a short cause that identifies the unreadable upstream error body.
In pinned mode, a network error or timeout SHALL return `502` with the same
normalized JSON error envelope because no upstream HTTP status exists.
When every attempt in chain mode fails, the route SHALL return `502`; the JSON
error envelope message SHALL contain the sanitized last upstream message and
`error.details` SHALL contain the last upstream status.

#### Scenario: Laya down

- **GIVEN** `laya` and `typesafe` are configured and Laya refuses the connection
- **WHEN** a request is posted
- **THEN** TypeSafe's answer is returned and Laya is in cooldown

#### Scenario: Request does not fit Laya

- **GIVEN** Laya answers `422` because the state exceeds its limit
- **WHEN** a request is posted in chain mode
- **THEN** TypeSafe's answer is returned and Laya is not in cooldown

#### Scenario: Request error from Jev

- **GIVEN** `typesafe` and `openrouter` are configured and TypeSafe answers `400`
- **WHEN** a request is posted
- **THEN** the `400` is returned and OpenRouter is not called

#### Scenario: Cooldown skip

- **GIVEN** Laya failed 10 seconds ago with the default cooldown
- **WHEN** a request is posted in chain mode
- **THEN** Laya is not called and TypeSafe answers

#### Scenario: Everything fails

- **GIVEN** every configured upstream answers `500`
- **WHEN** a request is posted
- **THEN** the response is `502`, its sanitized error message carries the last upstream message, and `error.details` carries the last upstream status

#### Scenario: Pinned upstream HTTP failure

- **GIVEN** a request pins Laya and Laya returns an HTTP error with a JSON body
- **WHEN** the route handles the response
- **THEN** it makes one attempt and returns Laya's status with the sanitized OmniRoute JSON error envelope

#### Scenario: Pinned transport failure

- **GIVEN** a request pins Laya and the connection times out
- **WHEN** the route handles the failure
- **THEN** it makes one attempt and returns `502` with normalized JSON containing a short cause

#### Scenario: Unreadable upstream error body

- **GIVEN** a pinned upstream returns an HTTP error with a non-JSON or unreadable body
- **WHEN** the route handles the response
- **THEN** it returns the upstream status with normalized JSON containing a short cause

The error envelope SHALL use the existing OmniRoute shape
`{ error: { message, type, details }, requestId }`; its message SHALL be
sanitized by the existing error-response helper.

### Requirement: Response normalization

A successful response SHALL have a string `model`, a `type` on every answer,
and numeric `usage.input_tokens` and `usage.output_tokens`. A missing `model`
from Laya SHALL become `laya/<routing.model>`, or `laya` when `routing` is
absent. A missing answer `type` SHALL be copied from the matching question.
Missing usage counters SHALL be `0`. All other upstream fields SHALL pass
through unchanged.

#### Scenario: Laya answer

- **GIVEN** Laya returns answers without `type`, no `model`, and `routing.model` `multilingual`
- **WHEN** the response is returned
- **THEN** `model` is `laya/multilingual` and each answer has the `type` of its question

#### Scenario: OpenRouter extras

- **GIVEN** OpenRouter returns `id`, `provider`, and `usage.cost`
- **WHEN** the response is returned
- **THEN** those fields are present unchanged

### Requirement: Usage logging and response metadata

The route SHALL save one call-log entry per upstream attempt with path
`/v1/systemone`, status, provider, `<upstream>/<model sent>` or
`<upstream>/default` when the request omits `model`, duration, token
counts from `usage`, and the error message on failure. It SHALL NOT store
`state`, `questions`, or answers. The response SHALL carry the OmniRoute meta
headers and `X-OmniRoute-SystemOne-Attempts` listing each attempt as
`<upstream>:<status>`. Reported cost SHALL be `usage.cost` when the upstream
returns it and `0` otherwise.

#### Scenario: Fallback is visible

- **GIVEN** Laya answers `503` and TypeSafe answers `200`
- **WHEN** the response is returned
- **THEN** two call-log entries exist and the attempts header is `laya:503,typesafe:200`

#### Scenario: No content in logs

- **GIVEN** a request whose `state` contains the text `secret-marker`
- **WHEN** it is served
- **THEN** no call-log entry contains `secret-marker`

#### Scenario: Omitted model log label

- **GIVEN** a request omits `model` and Laya is attempted
- **WHEN** the call-log entry is saved
- **THEN** its model is `laya/default`

### Requirement: Authorization and guardrails

The route SHALL apply the existing client-API authorization and SHALL call the
API key policy with `systemone/<requested model>`, using `auto` when the
request has no `model`. The route SHALL NOT apply the prompt-injection guard to
the request body.

#### Scenario: Restricted key

- **GIVEN** an API key whose allowed models do not include `systemone/*`
- **WHEN** it posts a valid request
- **THEN** the policy rejection is returned and no upstream is called

#### Scenario: Untrusted page text

- **GIVEN** a `state` containing "ignore all previous instructions"
- **WHEN** the request is posted with a permitted key
- **THEN** it is dispatched to an upstream
