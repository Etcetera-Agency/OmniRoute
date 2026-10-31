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

Historical fork-owned tests cover the actual processor/queue/Auto paths with
mocked transport: first candidate 504 followed by next-candidate success whose
response returns normalized evidence; target-timeout fallback beyond 600000 ms
but before 1,200,000 ms; exhaustion returning the native aggregate OmniRoute
failure to the caller while the queue records normalization failure; and
cooldown excluding the tuple on next selection. The saved 20-minute combo budget
passed against the native loop. These receipts do not imply production benchmark
inference or a scored result; no new test run is required for this documentation
correction.
