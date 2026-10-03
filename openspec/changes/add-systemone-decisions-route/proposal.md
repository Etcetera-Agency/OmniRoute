# Change: Add a System One decisions route

**Status:** Approved for implementation by the user on 2026-10-03.

## Why

Hermes scripts and browser micro-loops need a decision model: given a state and
typed questions, pick one option and return a calibrated probability. Two
interchangeable backends exist — self-hosted Laya and hosted TypeSafe Jev
(direct, or through OpenRouter). They share the `POST /v1/systemone` wire
shape.

Callers should hold one base URL and one OmniRoute key. OmniRoute should pick
the upstream, fall back when one is down or cannot fit the request, and log
usage. Today `/v1/systemone` falls through to the catch-all JSON 404.

## What Changes

- New route `POST /v1/systemone`, accepting the TypeSafe/Laya request shape.
- Ordered upstream chain, configured by environment: `laya` → `typesafe` →
  `openrouter`. Only configured upstreams take part.
- Per-upstream `model` rewrite. Laya rejects Jev model names, OpenRouter needs
  `typesafe/jev-1.13`, TypeSafe takes `jev-latest`.
- Response normalized to the TypeSafe shape so Jev tooling works against any
  upstream.
- Fallback on transport errors, `5xx`, `429`, and Laya capacity rejections
  (`413`, `422`), with a short in-memory cooldown.
- In pinned mode, an upstream HTTP failure keeps its HTTP status and returns a
  normalized JSON error with a short cause. Exhausting chain mode returns `502`
  with the last upstream failure.
- `OMNIROUTE_SYSTEMONE_ORDER` ignores unknown names and stably deduplicates
  repeats, keeping each upstream's first occurrence.
- Request bodies are capped at 1 MiB while reading, including when
  `Content-Length` is missing or inaccurate. `OPTIONS` uses standard OmniRoute
  CORS handling and never calls an upstream.
- One call-log row per upstream attempt and OmniRoute meta headers on the
  response. Request and response bodies are never stored.
- If request `model` is omitted, call-log model is `<upstream>/default`.
- No prompt-injection guard on this route: `state` is untrusted page content by
  design and the model cannot act on it.
- Behind `OMNIROUTE_SYSTEMONE`. Off by default; off means the same JSON 404 as
  today.

Not in this change: `/v1/systemone/batch`, dashboard provider cards, reuse of
dashboard connections, a price table for cost accounting.

## Impact

- Affected specs: new capability `systemone-decisions`.
- Affected code, all new files:
  - `src/app/api/v1/systemone/route.ts`
  - `open-sse/services/systemOne/{config,schema,dispatch}.ts`
  - `tests/unit/systemone-{schema,dispatch,route}.test.ts`
- No pre-existing upstream file is changed. The existing `/v1/:path*` rewrite
  and `/api/v1/*` client-API authorization already cover the new path.
- Independent of the auto quality band packages; no ordering dependency.
- Follow-up outside this repo: deploy Laya, point Hermes decision callers at
  `<omniroute>/v1/systemone`, add the flag and variables to the fork deploy
  playbook.
