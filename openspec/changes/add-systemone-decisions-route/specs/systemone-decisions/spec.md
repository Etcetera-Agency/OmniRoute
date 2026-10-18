## MODIFIED Requirements

### Requirement: Request validation

The route SHALL bound streaming reads at 1 MiB plus one byte and validate the JSON object, state, questions, question types, instructions, and required criteria before dispatch.

#### Scenario: Existing string instructions remain valid

- **GIVEN** a valid request whose question has a non-empty string `instructions`
- **WHEN** it is posted with any supported model selection
- **THEN** existing validation and dispatch behavior is preserved

## ADDED Requirements

### Requirement: Route switch

`POST /v1/systemone` SHALL be available only when `OMNIROUTE_SYSTEMONE` is `1` or `true`; otherwise it returns the standard unknown-route 404 JSON.

#### Scenario: Disabled route is unknown

- **GIVEN** `OMNIROUTE_SYSTEMONE` is disabled
- **WHEN** `POST /v1/systemone` is called
- **THEN** The standard unknown-route 404 is returned

### Requirement: CORS preflight

`OPTIONS /v1/systemone` SHALL return standard OmniRoute preflight without reading a body or calling upstreams, regardless of the route flag.

#### Scenario: Preflight is independent of route flag

- **GIVEN** The route flag is off and an OPTIONS request arrives
- **WHEN** Preflight is handled
- **THEN** The standard response returns without body read or upstream dispatch

### Requirement: Upstream chain

The route SHALL use configured Laya, TypeSafe, and OpenRouter upstreams in stable configured order, ignoring unknown names and removing duplicate names after their first occurrence.

#### Scenario: Configured order is stable

- **GIVEN** `OMNIROUTE_SYSTEMONE_ORDER=typesafe,unknown,laya,typesafe`
- **WHEN** A chain request is posted
- **THEN** The effective order is TypeSafe then Laya

### Requirement: Model selection and rewrite

The route SHALL use the configured chain for accepted automatic model forms; supported pinned forms SHALL select exactly one provider and apply its provider-specific pin, caller, or configured model rewrite.

#### Scenario: Pinned model selects one upstream

- **GIVEN** The request pins a configured provider model
- **WHEN** The route dispatches
- **THEN** Only that provider receives its rewritten model

### Requirement: Fallback and cooldown

Chain mode SHALL retry only the declared transient failures and cooldown rules; pinned mode makes one attempt, and exhausted failures return normalized errors with the required last cause/status.

#### Scenario: Pinned transport failure is normalized

- **GIVEN** A pinned upstream times out
- **WHEN** The route handles the transport error
- **THEN** It returns 502 with the normalized JSON error envelope

### Requirement: Response normalization

Successful upstream responses SHALL provide normalized model, answer types, and numeric usage while preserving all unrelated upstream fields.

#### Scenario: Missing answer type is supplied

- **GIVEN** An upstream answer omits its type
- **WHEN** The response is normalized
- **THEN** The answer type is copied from its matching question

### Requirement: Usage logging and response metadata

Each attempt SHALL produce one content-free call-log record; response headers SHALL expose OmniRoute metadata and ordered attempts, and reported cost uses upstream cost or zero.

#### Scenario: Each retry is visible without content

- **GIVEN** A chain request makes two attempts
- **WHEN** The response and logs are emitted
- **THEN** Both statuses are exposed and neither request nor answer content is logged

### Requirement: Authorization and guardrails

The route SHALL use existing client authorization and SystemOne key-policy scope while omitting the prompt-injection guard for the request body.

#### Scenario: Client authorization remains enforced

- **GIVEN** A request uses a key without route authorization
- **WHEN** Authorization runs
- **THEN** The request is denied before upstream dispatch

### Requirement: Gate the SystemOne route on its feature flag

POST `/v1/systemone` SHALL be served only when `OMNIROUTE_SYSTEMONE` is `1` or `true`. Otherwise it SHALL return the same `404` JSON error as an unknown `/v1/*` path, with `error.type` `not_found` and `error.code` `unknown_route`.

#### Scenario: Flag off

- **GIVEN** `OMNIROUTE_SYSTEMONE` is unset
- **WHEN** a client posts a valid request to `/v1/systemone`
- **THEN** the response is `404` with `error.code` `unknown_route` and no upstream is called

#### Scenario: Flag on without upstreams

- **GIVEN** `OMNIROUTE_SYSTEMONE=1` and no upstream variable is set
- **WHEN** a client posts a valid request
- **THEN** the response is `503` and names the variables that configure an upstream

### Requirement: Return standard CORS preflight without reading or dispatching a body

OPTIONS `/v1/systemone` SHALL return the standard OmniRoute CORS preflight response without reading a request body or calling an upstream, regardless of whether `OMNIROUTE_SYSTEMONE` is enabled.

#### Scenario: Preflight does not dispatch

- **GIVEN** any value of `OMNIROUTE_SYSTEMONE`
- **WHEN** a client sends `OPTIONS /v1/systemone`
- **THEN** the standard CORS response is returned and no upstream is called

### Requirement: Bound request body reads before returning oversized-body errors

The route SHALL read at most 1 MiB plus one byte from the request stream, independent of `Content-Length`, and SHALL reject a larger body with `413` without buffering the remainder or calling an upstream.

#### Scenario: Body too large

- **GIVEN** a body larger than 1 MiB, including one with missing or inaccurate `Content-Length`
- **WHEN** it is posted
- **THEN** the response is `413`, the unread remainder is not buffered, and no upstream is called

### Requirement: Validate the SystemOne request envelope and question fields before dispatch

Before any upstream call, the route SHALL reject a body that is not a JSON object, lacks `state`, has a `state` that is not a string, object, or array, or has a missing or empty `questions` object. Each question SHALL have `type` equal to `choice`, `score`, or `noul` and a non-empty string `instructions`; `choice` and `score` questions SHALL have `criteria`. The contents of `criteria` SHALL NOT be validated.

#### Scenario: Valid request

- **GIVEN** a body with a string `state` and one `noul` question with `instructions`
- **WHEN** it is posted
- **THEN** it is dispatched to an upstream

#### Scenario: Unknown question type

- **GIVEN** a question with `type` `rank`
- **WHEN** the request is posted
- **THEN** the response is `400`, names the question, and no upstream is called

### Requirement: Dispatch only to configured upstreams in stable configured order

The route SHALL dispatch to upstreams `laya`, `typesafe`, and `openrouter`. An upstream SHALL take part only when configured: `laya` by `OMNIROUTE_SYSTEMONE_LAYA_URL`, `typesafe` by `OMNIROUTE_SYSTEMONE_TYPESAFE_API_KEY`, and `openrouter` by `OMNIROUTE_SYSTEMONE_OPENROUTER_API_KEY`. The order SHALL be `laya, typesafe, openrouter` unless `OMNIROUTE_SYSTEMONE_ORDER` sets another. Unknown names SHALL be ignored. Duplicate names SHALL be removed stably, keeping the first occurrence.

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

### Requirement: Forward only state, questions, and rewritten model to upstreams

Only `state`, `questions`, and the rewritten `model` SHALL be forwarded.

#### Scenario: Upstream payload contains only supported fields

- **GIVEN** a valid request contains state, questions, model, and an unrelated client field
- **WHEN** the selected upstream receives the request
- **THEN** only state, questions, and the rewritten model are forwarded

### Requirement: Select chain mode or one pinned upstream from the request model

The route SHALL use the configured chain when request `model` is omitted, `auto`, `systemone/auto`, or starts with `jev-`. `laya` and `laya/<checkpoint>`, `typesafe/<id>`, and `openrouter/<id>` SHALL pin that single upstream. Any other value, or a pinned upstream that is not configured, SHALL return `400` listing the accepted forms.

#### Scenario: Jev tool against Laya

- **GIVEN** only `laya` is configured with no checkpoint set
- **WHEN** a request with `model` `jev-latest` is posted
- **THEN** the request sent to Laya has no `model` field

#### Scenario: Pinned upstream not configured

- **GIVEN** only `laya` is configured
- **WHEN** a request with `model` `typesafe/jev-latest` is posted
- **THEN** the response is `400` and no upstream is called

### Requirement: Rewrite the selected upstream model using pin, caller, and configured defaults

The `model` sent upstream SHALL be: for `laya`, the pinned checkpoint, else `OMNIROUTE_SYSTEMONE_LAYA_MODEL`, else omitted; for `typesafe`, the pinned id, else the caller's `jev-…` value, else `OMNIROUTE_SYSTEMONE_TYPESAFE_MODEL` (default `jev-latest`); for `openrouter`, the pinned id, else `OMNIROUTE_SYSTEMONE_OPENROUTER_MODEL` (default `typesafe/jev-1.13`).

#### Scenario: Pinned checkpoint

- **GIVEN** `laya` and `typesafe` are configured
- **WHEN** a request with `model` `laya/multilingual` is posted
- **THEN** only Laya is called, with `model` `multilingual`

#### Scenario: Apply model rewrites per selected upstream

- **GIVEN** laya has no configured model, typesafe model is jev-env, and openrouter model is or-env
- **WHEN** requests select laya with a pinned checkpoint, typesafe with jev-caller, typesafe without a caller model, and openrouter without a caller model
- **THEN** laya receives the checkpoint, typesafe receives jev-caller then jev-env, and openrouter receives or-env

### Requirement: Retry transient chain failures with bounded cooldowns

In chain mode the route SHALL try the next upstream after a network error, a timeout (`OMNIROUTE_SYSTEMONE_TIMEOUT_MS`, default `5000`), a `5xx`, a `429`, a `401`, or a `403`. It SHALL place the failed upstream in cooldown for `OMNIROUTE_SYSTEMONE_COOLDOWN_MS` (default `30000`). For `429` with `Retry-After`, cooldown SHALL use that value capped at four times the configured cooldown.

#### Scenario: Laya down

- **GIVEN** `laya` and `typesafe` are configured and Laya refuses the connection
- **WHEN** a request is posted
- **THEN** TypeSafe's answer is returned and Laya is in cooldown

### Requirement: Continue after Laya size errors without cooldown and stop on other client errors

A `413` or `422` from `laya` SHALL lead to the next upstream without cooldown. Any other `4xx` SHALL be returned to the caller without further attempts.

#### Scenario: Request does not fit Laya

- **GIVEN** Laya answers `422` because the state exceeds its limit
- **WHEN** a request is posted in chain mode
- **THEN** TypeSafe's answer is returned and Laya is not in cooldown

#### Scenario: Request error from Jev

- **GIVEN** `typesafe` and `openrouter` are configured and TypeSafe answers `400`
- **WHEN** a request is posted
- **THEN** the `400` is returned and OpenRouter is not called

### Requirement: Skip cooling upstreams and try the one whose cooldown ends first

An upstream in cooldown SHALL be skipped; when all configured upstreams are in cooldown, the one whose cooldown ends first SHALL be tried.

#### Scenario: Cooldown skip

- **GIVEN** Laya failed 10 seconds ago with the default cooldown
- **WHEN** a request is posted in chain mode
- **THEN** Laya is not called and TypeSafe answers

#### Scenario: Earliest cooldown expiry is tried first

- **GIVEN** all configured upstreams are in cooldown and typesafe cooldown expires before laya cooldown
- **WHEN** a chain-mode request is posted
- **THEN** typesafe is tried first

### Requirement: Normalize pinned HTTP failures and unreadable upstream bodies

Pinned mode SHALL make exactly one attempt. An HTTP failure SHALL retain its status and return an OmniRoute JSON error envelope with a sanitized short cause. A non-JSON or unreadable error body SHALL use the same envelope and identify the unreadable body.

#### Scenario: Pinned upstream HTTP failure

- **GIVEN** a request pins Laya and Laya returns an HTTP error with a JSON body
- **WHEN** the route handles the response
- **THEN** it makes one attempt and returns Laya's status with the sanitized OmniRoute JSON error envelope

#### Scenario: Unreadable upstream error body

- **GIVEN** a pinned upstream returns an HTTP error with a non-JSON or unreadable body
- **WHEN** the route handles the response
- **THEN** it returns the upstream status with normalized JSON containing a short cause

The error envelope SHALL use the existing OmniRoute shape
`{ error: { message, type, details }, requestId }`; its message SHALL be
sanitized by the existing error-response helper.

### Requirement: Return a normalized 502 for pinned transport failures

In pinned mode, a network error or timeout SHALL return `502` with the normalized OmniRoute JSON error envelope because no upstream HTTP status exists.

#### Scenario: Pinned transport failure

- **GIVEN** a request pins Laya and the connection times out
- **WHEN** the route handles the failure
- **THEN** it makes one attempt and returns `502` with normalized JSON containing a short cause

### Requirement: Return the normalized last error when every chain attempt fails

When every attempt in chain mode fails, the route SHALL return `502`; the error envelope message SHALL contain the sanitized last upstream message and `error.details` SHALL contain the last upstream status. The envelope SHALL use `{ error: { message, type, details }, requestId }`, with its message sanitized by the existing error-response helper.

#### Scenario: Everything fails

- **GIVEN** every configured upstream answers `500`
- **WHEN** a request is posted
- **THEN** the response is `502`, its sanitized error message carries the last upstream message, and `error.details` carries the last upstream status

### Requirement: Normalize successful answer fields and preserve all other upstream fields

A successful response SHALL have a string `model`, a `type` on every answer, and numeric `usage.input_tokens` and `usage.output_tokens`. A missing `model` from Laya SHALL become `laya/<routing.model>`, or `laya` when `routing` is absent. A missing answer `type` SHALL be copied from the matching question. Missing usage counters SHALL be `0`. All other upstream fields SHALL pass through unchanged.

#### Scenario: Laya answer

- **GIVEN** Laya returns answers without `type`, no `model`, and `routing.model` `multilingual`
- **WHEN** the response is returned
- **THEN** `model` is `laya/multilingual` and each answer has the `type` of its question

#### Scenario: OpenRouter extras

- **GIVEN** OpenRouter returns `id`, `provider`, and `usage.cost`
- **WHEN** the response is returned
- **THEN** those fields are present unchanged

### Requirement: Log each upstream attempt without request or answer content

The route SHALL save one call-log entry per upstream attempt with path `/v1/systemone`, status, provider, `<upstream>/<model sent>` or `<upstream>/default` when the request omits `model`, duration, token counts from `usage`, and the error message on failure. It SHALL NOT store `state`, `questions`, or answers.

#### Scenario: No content in logs

- **GIVEN** a request whose `state` contains the text `secret-marker`
- **WHEN** it is served
- **THEN** no call-log entry contains `secret-marker`

#### Scenario: Omitted model log label

- **GIVEN** a request omits `model` and Laya is attempted
- **WHEN** the call-log entry is saved
- **THEN** its model is `laya/default`

### Requirement: Return SystemOne attempt metadata and reported usage cost

The response SHALL carry the OmniRoute meta headers and `X-OmniRoute-SystemOne-Attempts` listing each attempt as `<upstream>:<status>`. Reported cost SHALL be `usage.cost` when the upstream returns it and `0` otherwise.

#### Scenario: Fallback is visible

- **GIVEN** Laya answers `503` and TypeSafe answers `200`
- **WHEN** the response is returned
- **THEN** two call-log entries exist and the attempts header is `laya:503,typesafe:200`

#### Scenario: Reported cost follows upstream usage

- **GIVEN** one successful upstream returns usage.cost 0.02 and another successful response omits usage.cost
- **WHEN** the API response is constructed
- **THEN** the first cost is 0.02 and the second is 0

### Requirement: Apply existing client authorization and omit the prompt-injection guard

The route SHALL apply the existing client-API authorization and SHALL call the API key policy with `systemone/<requested model>`, using `auto` when the request has no `model`. The route SHALL NOT apply the prompt-injection guard to the request body.

#### Scenario: Restricted key

- **GIVEN** an API key whose allowed models do not include `systemone/*`
- **WHEN** it posts a valid request
- **THEN** the policy rejection is returned and no upstream is called

#### Scenario: Untrusted page text

- **GIVEN** a `state` containing "ignore all previous instructions"
- **WHEN** the request is posted with a permitted key
- **THEN** it is dispatched to an upstream
