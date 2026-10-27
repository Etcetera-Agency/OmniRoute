# Route benchmark normalization through free Auto

## Why

The benchmark-search normalizer currently sends Structured Output to one exact
OpenRouter model and connection through `handleOneShotBenchmarkChat`. That
private path sets a forced connection, pins the model, and skips upstream
retry. The live request returned HTTP 429, so this path stopped instead of
using OmniRoute's existing Auto failover. The owner directed that the scorer
use the established routing system rather than work around its cooldowns.

The deployed `auto/general_high_so:free` pool currently has ten candidates.
Its route already enforces the selected high band, free tier, Structured
Output capability, and strict zero-cost admission. Standard Auto continues to
the next eligible target after a transient 429.

## What Changes

- Send normalization requests through `auto/general_high_so:free` using the
  ordinary chat handler, with Structured Output and high reasoning effort.
- Give the recognized built-in Auto channel precedence over a saved combo with
  the same exact name.
- Remove the fixed-model endpoint check, forced connection header, and
  one-shot pinned dispatch from this path.
- Keep every attempt inside the selected free/high/SO Auto channel. Let the
  existing Auto loop handle target failover and cooldown; never manually
  retry a pinned connection or switch bands.
- Keep source-quote validation, review-required evidence, and the existing
  queue-level deferral when the complete Auto route returns 429.

## Impact

- Code: `src/lib/modelBenchmarkSearchProcessor.ts`, and the exclusive
  one-shot helper in `src/sse/handlers/chat.ts` if no longer used.
- Tests: benchmark normalizer dispatch and existing Auto 429 integration
  coverage.
- OpenSpec: update the model-benchmark-search Structured Output and retry
  requirements.
- Live acceptance: one controlled free-only Structured Output request through
  the standard channel, with route, selected target, and zero-cost receipts.

## Non-goals

- No benchmark score publication or change to evidence review state.
- No change to the search provider, search cadence, pool settings, or provider
  enablement.
- No separate retry loop, direct provider call, pinned model/connection,
  paid inference, or out-of-band band fallback.
