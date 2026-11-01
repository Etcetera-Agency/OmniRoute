# Keep inference gateway responses open

> Current closure: parent accepted final runtime on 2026-11-01 and authorized
> archiving. Earlier runtime-pending and health-choice statements below are
> historical; selected functional contracts remain unchanged.

## Why

The production API bridge forwards from 20129 to 20128. Its default 600000 ms
socket inactivity deadline can expire while a nonstream Auto request progresses
through several finite backend attempts without emitting response bytes.

## What Changes

Use existing upstream deployment settings: API_BRIDGE_PROXY_TIMEOUT_MS=0 and
API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS=0. Leave REQUEST_TIMEOUT_MS unset so provider
timeouts retain their defaults. Keep the upstream resolver and forwarding timeout
selection unchanged; add no inference-specific derived field or classifier.

## Impact

Gateway timeout configuration is deployment-wide. No gateway source changes remain; caller cancellation behavior is the upstream implementation.
No provider, scoring, body/auth forwarding or route changes. Fork-owned HTTP tests
verify the selected production settings, fallback success, aggregate.
Existing upstream tests remain unchanged. Earlier default-policy implementation
is superseded by the owner's native-configuration decision on 2026-10-31.
