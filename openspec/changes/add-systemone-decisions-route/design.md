## Context

Decision models ("System One") are non-generative. A request carries a `state`
and named typed questions; the response carries one typed answer per question
with probabilities. Three upstreams speak this shape:

| Upstream     | Endpoint                                         | Auth                             | `model` it accepts                                                    |
| ------------ | ------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------- |
| `laya`       | `POST <base>/v1/systemone` (self-hosted)         | optional `Authorization: Bearer` | `english`, `multilingual`, `typed-decisions`, or omitted (own router) |
| `typesafe`   | `POST https://api.typesafe.ai/v1/systemone`      | `Authorization: Bearer`          | `jev-latest` or a pinned version                                      |
| `openrouter` | `POST https://openrouter.ai/api/alpha/decisions` | `Authorization: Bearer`          | `typesafe/jev-1.13`                                                   |

Request shape (TypeSafe documentation):

```json
{
  "state": "…or an object, or an array of text",
  "model": "jev-latest",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this",
      "criteria": { "billing": "Payment issues", "technical": "Bugs" }
    },
    "is_urgent": { "type": "noul", "instructions": "The message conveys urgency" }
  }
}
```

Response shape:

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "technical",
      "confidence": 0.78,
      "probabilities": { "technical": 0.85, "billing": 0.15 }
    },
    "is_urgent": { "type": "noul", "noul": 1.0 }
  },
  "usage": { "input_tokens": 392, "output_tokens": 65 }
}
```

Known differences between upstreams:

- Laya rejects Jev model names with `422`. Its example response has no
  top-level `model` and no `type` inside answers, and adds
  `routing: { model }`.
- OpenRouter adds `id`, `provider`, and `usage.cost`.
- Laya limits: more than 100 choice options → `413`; input over `max_len` →
  `422`; busy → `503` with `Retry-After`. Jev accepts a far larger state (32k
  tokens against Laya's 8 192 on the multilingual checkpoint).

The closest existing route is `/v1/classify`
(`src/app/api/v1/classify/route.ts` with
`open-sse/handlers/jinaFoundation.ts`): validate, enforce key policy, proxy one
JSON POST, save a call log, attach meta headers.

## Goals / Non-Goals

Goals:

- Jev-compatible tooling works by changing only its base URL and key.
- Laya first, Jev as fallback, with no caller involvement.
- Thin path. The caller makes one decision per browser step; added latency is
  paid on every click.
- Zero changes to pre-existing upstream files, so upstream syncs do not
  conflict.

Non-Goals:

- Batch endpoint. Laya has `/v1/systemone/batch`; TypeSafe documents none.
- Dashboard provider cards and reuse of dashboard connections. Those need
  edits to upstream provider registries.
- Cost accounting from a price table.
- Streaming, tool calls, or any chat-shaped translation.

## Decisions

### Feature flag

The route is active only when `OMNIROUTE_SYSTEMONE` is `1` or `true`. Otherwise
it answers exactly as the `/v1/*` catch-all does today: `404` with
`error.type = "not_found"` and `error.code = "unknown_route"`.

With the flag on and no upstream configured, the route answers `503` and names
the variables that configure one.

### Configuration

Environment only. An upstream is _configured_ when its required variable is
set.

| Variable                                 | Default                    | Meaning                                                              |
| ---------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `OMNIROUTE_SYSTEMONE`                    | unset                      | Enables the route                                                    |
| `OMNIROUTE_SYSTEMONE_ORDER`              | `laya,typesafe,openrouter` | Chain order; unknown names ignored; duplicates keep first occurrence |
| `OMNIROUTE_SYSTEMONE_LAYA_URL`           | unset                      | Laya base URL; required to configure `laya`                          |
| `OMNIROUTE_SYSTEMONE_LAYA_API_KEY`       | unset                      | Sent as Bearer when set                                              |
| `OMNIROUTE_SYSTEMONE_LAYA_MODEL`         | unset                      | Laya checkpoint; unset lets Laya's router pick                       |
| `OMNIROUTE_SYSTEMONE_TYPESAFE_API_KEY`   | unset                      | Required to configure `typesafe`                                     |
| `OMNIROUTE_SYSTEMONE_TYPESAFE_MODEL`     | `jev-latest`               | Model sent to TypeSafe in chain mode                                 |
| `OMNIROUTE_SYSTEMONE_OPENROUTER_API_KEY` | unset                      | Required to configure `openrouter`                                   |
| `OMNIROUTE_SYSTEMONE_OPENROUTER_MODEL`   | `typesafe/jev-1.13`        | Model sent to OpenRouter                                             |
| `OMNIROUTE_SYSTEMONE_TIMEOUT_MS`         | `5000`                     | Per-attempt timeout                                                  |
| `OMNIROUTE_SYSTEMONE_COOLDOWN_MS`        | `30000`                    | How long a failed upstream is skipped                                |

Upstream URLs come from the operator's environment, never from the request, so
no outbound URL guard is applied. A private Laya address is expected.

### Model selection

The request `model` chooses the chain, not the upstream model.

| Request `model`                    | Upstreams tried   | `model` sent upstream                                            |
| ---------------------------------- | ----------------- | ---------------------------------------------------------------- |
| omitted, `auto`, `systemone/auto`  | configured chain  | per-upstream default                                             |
| `jev-…` (for example `jev-latest`) | configured chain  | Laya: default; TypeSafe: the caller's value; OpenRouter: default |
| `laya`                             | `laya` only       | Laya default                                                     |
| `laya/<checkpoint>`                | `laya` only       | `<checkpoint>`                                                   |
| `typesafe/<id>`                    | `typesafe` only   | `<id>`                                                           |
| `openrouter/<id>`                  | `openrouter` only | `<id>`                                                           |

A pinned upstream that is not configured, or any other value, is a `400` that
lists the accepted forms. The `jev-…` rule is what lets existing Jev tools run
unchanged.

### Validation

Checked before any upstream call. The route reads at most 1 MiB plus one byte
from the request stream; it rejects an over-limit body with `413` without
buffering the remainder. It does not rely on `Content-Length` for the limit.

- body is a JSON object no larger than 1 MiB (`413` above that);
- `state` is present and is a string, an object, or an array;
- `questions` is a non-empty object;
- each question has `type` in `choice | score | noul` and a non-empty string
  `instructions`; `choice` and `score` have `criteria`.

The shape of `criteria` is not validated further. The upstream contract is the
authority, and a stricter local rule would reject requests that upstreams
accept.

Only `state`, `questions`, and the rewritten `model` are forwarded.

### Fallback

| Attempt outcome            | Action                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `2xx`                      | normalize and return                                                                   |
| network error or timeout   | cooldown, next upstream                                                                |
| `5xx`                      | cooldown, next upstream                                                                |
| `429`                      | cooldown (`Retry-After` when present, capped at the cooldown value × 4), next upstream |
| `401`, `403`               | cooldown, next upstream, error logged                                                  |
| `413` or `422` from `laya` | next upstream, no cooldown                                                             |
| any other `4xx`            | return to the caller, no further attempts                                              |

Laya's `413`/`422` mean "this request does not fit this model". Local
validation has already removed malformed requests, so trying Jev is correct and
Laya stays healthy for the next call. A `4xx` from a Jev upstream would repeat
on the other Jev upstream, so it is returned at once.

An upstream in cooldown is skipped. When every configured upstream is in
cooldown, the one whose cooldown ends first is tried anyway. In pinned mode
there is no fallback: one attempt is made. An upstream HTTP failure keeps its
HTTP status and returns the existing OmniRoute `createErrorResponse` JSON
envelope with a sanitized short cause. A response whose body is not JSON or
cannot be read is converted to that same envelope, with a short cause that
explains the unreadable upstream error body.
Since a network error or timeout has no upstream HTTP status to preserve, a
pinned transport failure returns `502` with the same normalized JSON envelope.

When every attempt in chain mode fails, the route returns `502` with the last
upstream status and sanitized cause. Cooldown state is in-memory and
per-process.

Implementation order:

```text
read request stream in chunks, retaining at most 1 MiB + 1 byte
cancel stream immediately after observing byte 1 MiB + 1
if over cap: return 413; do not parse or dispatch
parse and validate JSON; resolve selected upstream chain
for each upstream in effective order:
  skip it when cooling down unless all configured upstreams are cooling down
  build upstream-specific model and request; apply per-attempt timeout
  log status, provider, model, duration, usage, and short failure cause only
  if success: normalize response and return with OmniRoute metadata
  if pinned HTTP failure: create sanitized OmniRoute JSON error envelope;
    return original HTTP status
  if pinned network error or timeout: return 502 with normalized JSON error
  if retryable chain failure: update cooldown as specified; continue
  otherwise: create sanitized OmniRoute JSON error envelope;
    return upstream HTTP status
return 502 with last upstream status and sanitized short cause
```

The normalized error envelope uses the existing shape
`{ error: { message, type, details }, requestId }`; `message` is the sanitized
short cause. Arbitrary upstream error bodies are not passed through.

### Response normalization

The response is the upstream JSON with these guarantees:

- `model` is a string: the upstream's value, or `laya/<routing.model>` when
  Laya omits it (plain `laya` when `routing` is absent too);
- every answer has `type`, copied from the matching question when missing;
- `usage.input_tokens` and `usage.output_tokens` are numbers, `0` when missing.

All other upstream fields pass through unchanged.

### Logging and metadata

One call-log row per attempt through `saveCallLog`: path `/v1/systemone`,
status, `provider` (`laya`, `typesafe`, `openrouter`), `model` as
`<upstream>/<model sent>` or `<upstream>/default` when the request model is
omitted, duration, tokens from `usage`, connection id
`env:OMNIROUTE_SYSTEMONE_<UPSTREAM>`, and the error message on failure. Neither
`state`, `questions`, nor answers are logged.

The response carries the standard OmniRoute meta headers (provider, model,
latency, request id; cost from `usage.cost` when the upstream reports it, else
`0`) and `X-OmniRoute-SystemOne-Attempts`, for example
`laya:422,typesafe:200`.

`OPTIONS` uses the standard OmniRoute CORS preflight response and MUST NOT read
the request body, inspect upstream configuration, or call an upstream.

### Authorization and guardrails

The path is under `/api/v1`, so existing client-API authorization applies.
`enforceApiKeyPolicy` is called with `systemone/<requested model or auto>`.

The route is not wrapped in `withInjectionGuard`. `state` is page text or other
untrusted content by design, a guard would block or log on ordinary pages, and
a decision model returns only a choice among caller-supplied options.

### Isolation from upstream

Everything lives in new files. The route imports upstream helpers
(`enforceApiKeyPolicy`, `saveCallLog`, `attachOmniRouteMetaHeaders`,
`errorResponse`, validation helpers) and does not edit them. The request schema
stays in `open-sse/services/systemOne/schema.ts`, not in the shared
`schemas/apiV1.ts`.

`docs/openapi.yaml` is left untouched. Route coverage in this checkout is about
97% of paths and 93% of operations against floors of 35.9% and 34.4%, so one
undocumented route does not trip `openapi-coverage.test.ts`.

## Risks / Trade-offs

- **Environment-only credentials.** No dashboard visibility, no quota
  preflight. Acceptable for one operator; dashboard cards are a later change.
- **In-memory cooldown.** Lost on restart and not shared between processes.
  The worst case is one extra failed attempt.
- **Fallback hides a broken Laya.** Calls keep succeeding on paid Jev. The
  attempts header and per-attempt log rows make it visible; the deploy playbook
  should add a check on `laya` error rows.
- **Cost is under-reported.** TypeSafe direct returns no cost, so those rows
  log `0`.
- **Unverified upstream details**, to confirm during implementation:
  - the OpenRouter request shape here comes from a third-party write-up, not
    OpenRouter's own reference;
  - TypeSafe's error body format is undocumented in the sources read;
  - Laya's README shows answers without `type`; normalization covers it either
    way.

## Migration Plan

1. Merge with the flag off. Behavior is unchanged.
2. Deploy Laya, set `OMNIROUTE_SYSTEMONE_LAYA_URL`, enable the flag on a test
   instance, run the checks below.
3. Add the TypeSafe key for fallback.
4. Point Hermes decision callers at `<omniroute>/v1/systemone`.

Rollback: unset `OMNIROUTE_SYSTEMONE`.

## Required pre-cutover checks

- A Russian or Ukrainian `state` routed to Laya returns a normalized answer.
- With Laya stopped, the same request is answered by TypeSafe and the attempts
  header shows both.
- An oversized `state` gets `422` from Laya and an answer from TypeSafe, and
  the next small request goes to Laya again.
- Added latency through OmniRoute against a direct Laya call, over 50
  requests; record the median.
- A key restricted by `allowedModels` is rejected unless `systemone/*` is
  allowed.
- With the flag off, the response body equals the catch-all 404 body.
