## 1. Failing tests first

- [x] 1.1 `systemone-schema.test.ts`: valid request with `choice`, `score`, and `noul` questions passes; non-object body, missing `state`, `state` of a wrong type, missing or empty `questions`, unknown `type`, empty `instructions`, `choice`/`score` without `criteria` each fail with a message naming the field; `criteria` contents are not inspected; body over 1 MiB → `413` (schema tests pass).
- [x] 1.2 `systemone-dispatch.test.ts`, configuration: upstream is configured only when its required variable is set; `OMNIROUTE_SYSTEMONE_ORDER` reorders, ignores unknown names, and stably deduplicates repeats by keeping their first occurrence; defaults for models, timeout, cooldown.
- [x] 1.3 `systemone-dispatch.test.ts`, model selection: omitted, `auto`, `systemone/auto`, and `jev-latest` use the chain; `jev-1.13.0` is forwarded to TypeSafe and replaced for Laya and OpenRouter; `laya`, `laya/multilingual`, `typesafe/jev-latest`, `openrouter/typesafe/jev-1.13` pin one upstream with the right outgoing `model`; Laya request has no `model` when no checkpoint is set; pinned-but-unconfigured and unknown values → `400` listing accepted forms.
- [x] 1.4 `systemone-dispatch.test.ts`, outgoing request per upstream: URL, `Authorization` header (absent for Laya without a key), body contains only `state`, `questions`, `model`.
- [x] 1.5 `systemone-dispatch.test.ts`, fallback: network error, timeout, `500`, `503`, `429`, `401` on Laya → TypeSafe answers and Laya enters cooldown; `429` honors `Retry-After` up to the cap; Laya `413`/`422` → TypeSafe answers and Laya has no cooldown; TypeSafe `400` is returned without trying OpenRouter; all chain attempts fail → `502` with last status and message; pinned HTTP failure makes one attempt and returns its status with normalized JSON; pinned network/timeout failure → `502` with normalized JSON; invalid/unreadable error bodies become normalized JSON with a short cause; upstream in cooldown is skipped; all in cooldown → earliest expiry is tried.
- [x] 1.6 `systemone-dispatch.test.ts`, normalization: Laya response without `model` and without answer `type` gains `model: "laya/<routing.model>"` and per-answer `type`; missing `usage` fields become `0`; OpenRouter `id`, `provider`, `usage.cost` and Laya `routing` pass through.
- [x] 1.7 `systemone-route.test.ts`: flag off → `404` body identical in shape to catch-all (`error.type`, `error.code`, `error.path`); flag on with no configured upstream → `503` naming missing variables; invalid JSON → `400`; actual streamed body over 1 MiB → `413` even if `Content-Length` is missing/inaccurate, with no upstream call; `OPTIONS` returns standard CORS response and makes no upstream call; `enforceApiKeyPolicy` rejection is returned as is and receives `systemone/<model or auto>`; a `state` containing prompt-injection phrases is not blocked.
- [x] 1.8 `systemone-route.test.ts`, logging: one `saveCallLog` call per attempt with path, status, provider, `<upstream>/<model>` or `<upstream>/default` when request model omitted, tokens from `usage`, and `env:` connection id; no call-log field contains `state`, `questions`, or answers; response has OmniRoute meta headers and `X-OmniRoute-SystemOne-Attempts`.

## 2. Implementation

- [x] 2.1 `open-sse/services/systemOne/config.ts`: flag, environment loader, upstream table, defaults.
- [x] 2.2 `open-sse/services/systemOne/schema.ts`: request schema and model-selection parser.
- [x] 2.3 `open-sse/services/systemOne/dispatch.ts`: per-upstream request build, timeout, fallback matrix, cooldown map, normalization, per-attempt call log.
- [x] 2.4 `src/app/api/v1/systemone/route.ts`: `OPTIONS` and `POST`; flag gate, JSON parse, validation, key policy, dispatch, meta headers. No `withInjectionGuard`.
- [x] 2.5 Run Code Simplifier on the slice.

## 3. Verification

- [x] 3.1 `systemone-*` tests pass (46/46); OpenAPI coverage 8/8 and route checker has 276 baseline entries with 0 new findings.
- [x] 3.2 SystemOne implementation is isolated to new route/service/test files; no pre-existing upstream file was changed by this package.
- [ ] 3.3 Test instance, flag on, Laya only: Russian and Ukrainian `state` return normalized answers.
- [ ] 3.4 Laya stopped: request is answered by TypeSafe; attempts header and call logs show both attempts.
- [ ] 3.5 Oversized `state`: Laya `422`, TypeSafe answers, next small request goes to Laya.
- [ ] 3.6 Latency: 50 requests direct to Laya and 50 through OmniRoute; record both medians in the deploy playbook.
- [ ] 3.7 OpenRouter upstream: confirm the request and response shape against the live API before setting its key in production.
- [ ] 3.8 A key with `allowedModels` is rejected until `systemone/*` is allowed.
- [ ] 3.9 Flag off in production: `/v1/systemone` returns the catch-all 404.
- [x] 3.10 Update the fork deploy playbook: flag, variables, rollback, a check on `laya` error rows (docs and OpenAPI updated; docs checks pass).
