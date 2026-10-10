# Design: pinned browser instruction object

## Boundary

SystemOne validates `questions.*.instructions` before dispatch. The change is
limited to that field. `model` already selects a single pinned upstream and
checkpoint; only the exact value `laya/laya-browser-v19s` enables the native
browser instruction object. String instructions retain existing behavior for
every model, including that pinned model.

## Validation contract

The accepted browser object is exactly:

```json
{ "goal": "browser goal", "operation": "CLICK", "rules": "Choose Books" }
```

`goal` must be a string. `rules` must be a string or a list of strings.
`operation` is optional for ordinary question IDs; when present it must be
`CLICK`, `TYPE_TEXT`, or `SELECT`. A target question ID matching
`(?:^|_)(click|type_text|select)_target$` case-insensitively requires its
matching operation. These checks mirror
`ops/laya/browser-checkpoint/browser_adapter.py`'s native normalization. The
object itself is strict, so unrelated shapes and extra properties remain
invalid.

## Dispatch pseudocode

```text
parse incoming JSON with existing SystemOne request schema
for each question:
  if instructions is string:
    require existing non-empty-string rule
  else if instructions is strict browser-object:
    require request.model == "laya/laya-browser-v19s"
    require goal is string
    require rules is string or array of strings
    if operation exists, require CLICK, TYPE_TEXT, or SELECT
    if question ID matches target pattern:
      require operation and require it matches the target
  else:
    reject request

select the existing pinned Laya plan
serialize existing { state, questions, model } upstream body
preserve questions.*.instructions value exactly as parsed JSON
```

No request field, auth header, retry path, route policy, upstream config, or
response normalization changes. Existing dispatch serializes the original
`questions` subtree, so regression tests verify byte-equivalent JSON value
preservation at the object level.

## Living specification baseline

The broader add-systemone-decisions-route package remains open and has no living capability yet. This archive creates only the shipped Request validation baseline; its delta is ADDED because no living requirement existed. Broader failover/capacity and acceptance requirements remain in their active package and TODO.
