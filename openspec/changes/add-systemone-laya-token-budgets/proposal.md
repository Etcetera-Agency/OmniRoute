# Add pinned Laya request token budgets

## Why

Callers that explicitly pin `/v1/systemone` to Laya need to size the option
prompt and total token window for one request. Laya exposes `max_len` and
`head_max_len` as request overrides, but OmniRoute currently drops both.

## What Changes

- Accept optional positive-integer `max_len` and `head_max_len` fields.
- Bound `max_len` by `LAYA_MAX_TOKEN_BUDGET`, defaulting to `8192` when unset
  or invalid.
- Require `max_len` when `head_max_len` is supplied, and require
  `head_max_len <= max_len`.
- Forward supplied budgets only for an explicit pinned Laya model. Strip them
  from chain, TypeSafe, and OpenRouter requests.
- Preserve the current outgoing request bytes when neither budget is supplied.
- Document the request contract and the environment ceiling.

## Impact

- Capability: `systemone-decisions`.
- Code: `open-sse/services/systemOne/{config,schema,dispatch}.ts` and
  `src/app/api/v1/systemone/route.ts`.
- Tests: `tests/unit/systemone-{schema,dispatch,route}.test.ts`.
- References: API and environment docs, `.env.example`, and `openspec/TODO.md`.
- No change to auth policy, response shape, model selection, fallback order,
  or attempt count.

## Out of Scope

- Applying budgets to automatic or Jev chain requests.
- Sending these Laya-only fields to TypeSafe or OpenRouter.
- Changing Laya deployment settings or request defaults.
