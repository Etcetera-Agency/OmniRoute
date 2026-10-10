# Fix pinned Laya browser instruction objects

## Why

The SystemOne request validator currently requires every question's
`instructions` value to be a non-empty string. The pinned browser checkpoint
`laya/laya-browser-v19s` uses a native structured instruction object with
`goal`, `operation`, and `rules`; validation rejects that request with HTTP
400 before it reaches Laya. This prevents the retained browser model from
running through OmniRoute SystemOne.

## What Changes

- Continue accepting the current non-empty string instruction form for all
  existing SystemOne models.
- Accept a structured `{ goal, operation, rules }` instruction only when the
  request pins `model` to `laya/laya-browser-v19s`. Native Browser v19s
  instructions require `goal` and `rules`; `operation` is optional except for
  target question IDs.
- Match the native adapter's `CLICK`, `TYPE_TEXT`, and `SELECT` operation set,
  target-ID operation match, and string-or-string-list `rules` format.
- Preserve the structured JSON value through request parsing and Laya proxying.
- Keep upstream choice, auth headers, request-size limits, and response
  normalization unchanged.

## Impact

- Capability: existing `systemone-decisions` request validation.
- Code: `open-sse/services/systemOne/schema.ts`; dispatch behavior is already
  pass-through for nested question fields and will be protected by a test.
- Tests: `tests/unit/systemone-{schema,dispatch,route}.test.ts`.
- Operations: production use remains pending an explicit deployment approval
  and a live Browser v19s request through SystemOne; record both in
  `openspec/TODO.md`.

## Selected Design

Use one discriminated validation rule on the already-present pinned model
string. Existing string instructions keep their current validation and value.
For the exact pinned model, allow either the existing string form or a strict
object with string `goal`, `rules` as a string or string array, and an optional
`operation` from `CLICK`, `TYPE_TEXT`, or `SELECT`. For question IDs matching
`(?:^|_)(click|type_text|select)_target$` case-insensitively, require the
operation and require it to match the captured target. Reject object
instructions for every other model. Do not change dispatch construction: it
already forwards the complete `questions` object as JSON.
