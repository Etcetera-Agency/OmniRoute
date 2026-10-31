# Fix models.dev structured-output fallback

## Why

The shared model-capability resolver can see explicit `structured_output=true`
in models.dev rows for the same canonical model ID served by other providers,
but currently resolves only the requested provider's row. A request therefore
remains unknown when its own native row omits the capability, even though the
approved catalog already declares it for that exact model ID.

## What Changes

- Preserve the requested provider/connection/model's native structured-output
  boolean as highest priority. Native `false` remains a veto; native `true`
  remains authoritative.
- Only when that native value is absent, resolve `true` if any models.dev
  `model_capabilities` row has the same canonical `model_id` and explicitly
  declares `structured_output=true`. Other providers' `false`, `null`, missing
  values, and row order do not veto or satisfy this rule.
- Resolve known `free/<model>` identities through the existing exact registry
  helper. Do not derive identities from similar names, prefixes, tools, provider
  branding, or APInex-specific rules.
- Keep unknown as `null`, so existing structured-output band filters continue
  to deny unknown models.

## Non-goals

No provider/model configuration, per-model overrides, provider-specific gates,
paid fallback, scoring, free classification, pricing, quota, startup, catalog
sync, or benchmark behavior changes. No live provider request is part of this
change.

## Impact

- `src/lib/modelCapabilities.ts`: common structured-output resolver fallback.
- `tests/unit/compatible-model-capability-resolution.test.ts`: resolver
  regressions using isolated synced rows and compatible metadata snapshots.
- `openspec/specs/model-capability-resolution/spec.md`: new shared resolver
  requirement, merged during OpenSpec archiving.
