# Keep inference gateway responses open

## Why

The shipped standalone entry starts the API bridge (normally API port 20129 to
dashboard port 20128). The bridge applies an implicit 600000 ms forwarding socket
timeout to inference requests, including nonstream Auto requests. The backend can
legitimately run several finite target attempts beyond that quiet interval. The
bridge then destroys its application connection and returns api_bridge_timeout
instead of the backend success or aggregate result.

## What Changes

- Remove only the implicit forwarding timeout for POST to exact endpoints
  /v1/chat/completions, /chat/completions, /v1/responses, /responses and
  /v1/messages (optional trailing slash; query ignored). Accept alone, GET and
  subresources do not identify inference operations.
- Derive inferenceProxyTimeoutMs in the canonical timeout resolver. A nonblank
  REQUEST_TIMEOUT_MS, API_BRIDGE_PROXY_TIMEOUT_MS, or
  API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS preserves the existing max(proxy, request)
  resolution, including zero and invalid-value fallback semantics.
- Keep the existing raw request pipe, headers, auth forwarding, noninference
  timeout, legacy path/Accept max timeout fallback, incoming request/header/socket
  settings, and response streaming logic.
- Prove caller disconnect closes the bridge's application connection after the
  request body is complete; add response-close cleanup only if regression proves
  the existing request-aborted handler insufficient.

## Impact

Production scope is src/lib/apiBridgeServer.ts and
src/shared/utils/runtimeTimeouts.ts. This is a narrowly shared inference transport
default: it also covers non-Auto inference and saved combos with arbitrary names.
It reads no JSON body or database and introduces no configuration or hooks.
Finite target timeouts and an explicit combo deadline remain backend concerns.
This change is local, implemented and unarchived; deployment is outside scope.

Fork-owned verification lives in tests/unit/auto-fallback-http-response.test.ts,
tests/unit/auto-fallback-request-lifetime.test.ts and
tests/unit/fork-api-bridge-timeout-policy.test.ts. Existing tracked upstream test
fixtures are restored unchanged and are not the current acceptance path.
