# Design: pinned Laya token budgets

## Contract

`max_len` and `head_max_len` are optional JSON number fields on
`POST /v1/systemone`. Each supplied value must be a positive safe integer;
booleans, fractions, zero, negatives, null, and strings are invalid. If
`head_max_len` is present, `max_len` must also be present. When both are
present, `head_max_len` must not exceed `max_len`.

OmniRoute reads `LAYA_MAX_TOKEN_BUDGET` from its own environment. An unset,
invalid, non-positive, or unsafe integer value uses the Laya default `8192`.
`max_len` above the effective ceiling returns HTTP 400 before API-key policy
or any upstream request. Operators must keep this value aligned with the
configured Laya service ceiling; a gateway request cannot raise that limit.

The fields affect only a request whose model explicitly pins Laya (`laya` or
`laya/<checkpoint>`). Automatic, `systemone/auto`, and `jev-*` chain requests
keep their existing behavior, even if their first planned upstream is Laya.
Pinned TypeSafe and OpenRouter requests also keep their existing outgoing body.

## Request construction

```text
parse request JSON
validate existing SystemOne fields
validate max_len and head_max_len types and positive integer range
if head_max_len exists and max_len is absent: return existing 400 error envelope
if max_len exists and max_len > effective LAYA_MAX_TOKEN_BUDGET: return 400
if both exist and head_max_len > max_len: return 400
validate model and API-key policy using existing order
build existing {state, questions, rewritten model} upstream body
if model pins Laya and a budget field was supplied:
    copy each supplied budget field into that Laya request
otherwise:
    omit both budget fields
dispatch with existing status, fallback, cooldown, and response handling
```

No budget key is added when the caller omits that key. In particular, omitting
both fields keeps the exact existing serialized body bytes. A valid request
pinned to a non-Laya upstream may contain these optional fields, but the
upstream projection omits them.

## Failure behavior

Validation uses the route's existing HTTP 400 JSON error path, before API-key
policy and dispatch. It does not create call-log attempts or alter successful
response bodies, auth decisions, fallback behavior, or model pinning.

## Evidence boundary

Laya's HTTP API contract says both fields are optional per-request overrides;
an omitted field leaves the deployment's Router setting in force, and the
server rejects overrides above `LAYA_MAX_TOKEN_BUDGET`. Since the effective
`max_len` default may vary by deployment, `head_max_len` without explicit
`max_len` is rejected rather than compared with a guessed default.
