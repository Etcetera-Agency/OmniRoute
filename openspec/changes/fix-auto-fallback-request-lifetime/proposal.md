# Configure native Auto lifetime for benchmark normalization

## Why

Native Auto already falls through temporary provider failures and has a shared
attempt cap30 (hard200). Its implicit safety window is600000ms; the benchmark
normalizer's current caller budget is1200000ms. A finite400000ms target timeout
followed by250000ms fallback exceeds the implicit window while remaining within
the normalizer's budget. Historical incident pool/stop cause remains unknown.

## What Changes

Use existing saved comboDefaults.comboTimeoutMs=1200000 instead of modifying the
loop. Preserve native attempt accounting, three-identical-model-error stop,
finite target deadlines, client cancellation, aggregate handling and scoring.
Enable native modelLockout separately. No production source changes remain.

## Impact

comboDefaults is a shared operator policy; concrete combo/provider overrides retain
native precedence. The normalizer calls handleChat directly, not the gateway.
Its own20min caller deadline is unchanged. Existing strict-free general-high SO
admission remains in force. Unknown models must exist in active synced catalog.

## Acceptance

Fork-owned tests execute actual benchmark processor/queue/Auto paths with mocked
transport: first504 then normalized result, actual target-timeout fallback beyond
600000ms but before1200000ms, pool exhaustion settles row, cooling excludes tuple
on next selection. Native20min configuration passes with original BASE loop.
No production benchmark inference or scored result is implied by local fixtures.
