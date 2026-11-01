# Chosen design

> Current closure: parent accepted final runtime on 2026-11-01 and authorized
> archiving. Earlier runtime-pending and health-choice statements below are
> historical; selected functional contracts remain unchanged.

## Upstream configuration

The native bridge uses proxyTimeoutMs for ordinary requests and max(proxyTimeoutMs,
serverRequestTimeoutMs) for its existing streaming/path classification. Therefore
both inputs must be zero to remove the forwarding deadline reliably.

```text
production Compose environment:
  API_BRIDGE_PROXY_TIMEOUT_MS = "0"
  API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS = "0"
  REQUEST_TIMEOUT_MS remains unset

getApiBridgeTimeoutConfig and getProxyTimeoutMs:
  unchanged upstream implementation

proxyRequest(req, res): unchanged upstream implementation
```

The two environment settings apply to all gateway requests, including receiving
the incoming request body. Header/keepalive protections remain unchanged. Provider
fetch default remains 600000ms; readiness remains 80000ms. Auto retains finite per-target deadlines, the upstream shared total-attempt cap and client cancellation.

Keep `REQUEST_TIMEOUT_MS` unset. The existing generic SDK timeout issue remains
in root TODO; this package adds no new upstream follow-up.

## Verification

Use real ephemeral HTTP caller -> bridge -> adapter -> production POST route and
Auto loop, with two seeded strict-free candidates and mocked provider fetches.
Configure the native gateway-only zeros before importing the bridge. A scaled
legacy 600000ms socket timer reproduces failure if those settings are omitted;
backend target timers remain finite and unscaled. Verify the caller stays pending
through the first timeout and receives exact success or both-target aggregate.
Assert body/auth forwarding.

Separate module instances verify unchanged default path/Accept timeout selection
and each explicit positive deadline. Resolver coverage asserts gateway-only zeros
do not change provider timeout configuration. Do not modify upstream tests.

## Release

The initial GitHub build for 03039b56838caea7533955404834b9799ab0e23f was cancelled
before publication/deploy. Native settings are staged in persistent production
Compose files; actual container activation awaits the authorized app-only restart; no image build is required for environment changes.
