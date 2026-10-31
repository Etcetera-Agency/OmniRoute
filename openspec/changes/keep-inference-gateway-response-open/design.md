# Chosen design

## Boundary

Docker CMD dev/run-standalone.mjs selects server-ws.mjs, which loads server.js.
Next instrumentation starts createApiBridgeServer on the API port. proxyRequest
forwards directly to the application over loopback. Its http.request timeout is
socket inactivity, so backend-only progress cannot extend it. Nonstream JSON has
no response bytes before the final result. Existing direct HTTP route tests
bypass this bridge and remain positive coverage.

## Resolution and pseudocode

Use getApiBridgeTimeoutConfig and its existing hasEnvValue helper. Resolve all
existing fields unchanged, lifting the existing serverRequestTimeoutMs expression
into a local variable. Add exactly one derived field:

```text
explicit = any hasEnvValue(env, key) for
  REQUEST_TIMEOUT_MS, API_BRIDGE_PROXY_TIMEOUT_MS,
  API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS
inferenceProxyTimeoutMs = explicit
  ? max(proxyTimeoutMs, serverRequestTimeoutMs)
  : 0

getProxyTimeoutMs(req):
  operation = method == POST and exact recognized endpoint (optional final slash)
  if operation and inferenceProxyTimeoutMs == 0: return 0
  if requestWantsStreaming(req): return max(proxyTimeoutMs, serverRequestTimeoutMs)
  return proxyTimeoutMs

proxyRequest(req, res):
  create existing targetReq with selected timeout
  retain existing timeout/error response and request-aborted behavior
  if proven necessary: on res.close, destroy targetReq only if res not ended
  req.pipe(targetReq)  // unchanged bytes and forwarding headers
```

No JSON buffering, model prefix check, DB lookup, flag, provider/routing change or
mechanical timeout increase. Explicit zero continues to use the preexisting max
rule (a zero proxy override alone can still inherit the request timeout).
Incoming request/header/keepalive/socket policy is unchanged.

## P2 correction: operation classification

Only POST to /v1/chat/completions, /chat/completions, /v1/responses,
/responses and /v1/messages (optional trailing slash, query ignored) can skip the
implicit forwarding window. GET, count_tokens and other subresources, and an
SSE Accept header alone retain legacy forwarding policy. Existing broad
requestWantsStreaming path/Accept classification is retained solely as the legacy
max(proxy, server request) fallback, including explicit policy on all operations.
A zero derived inference timeout is safe as the exemption condition: it means
implicit policy or an explicit max of zero, where both legacy inputs are zero.
This also preserves /v1/messages explicit JSON behavior (proxy timeout rather than
max) and messages with SSE Accept (legacy max), rather than silently widening the
explicit policy of the newly recognized endpoint.

Source grounding: src/app/api/v1/messages/route.ts postHandler forwards the
unchanged model/body to handleChat, including the nonstream branch at line 99;
POST wraps that handler with admission/injection guards. MCP traces confirm the
same chat engine. next.config.mjs rewrites /v1/:path* to /api/v1/:path* and
provides /chat/completions and /responses aliases. No /messages alias is added.
The exact messages endpoint is eligible; /v1/messages/count_tokens is not.
The existing bridge allowlist remains unchanged; this operation policy applies
after admission. Versioned trailing-slash forms are covered by the fixture.
No HTTP route/provider/routing module needs modification.

Classification tests use actual POST for inference and GET for query cases.
Native options must retain 600000 for GET /v1/models accepting SSE. With only
API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS=900000, that same request retains 900000;
ordinary /v1/models JSON retains 600000. Exact POST aliases/messages get zero
only under implicit policy. GET inference-named paths and POST subresources
retain the old max/proxy behavior.

## Verification

Before the fix, scale only native http.request options.timeout === 600000 to a
short window in an isolated test process; do not scale backend target timers or
introduce a production timeout setting. Real ephemeral caller -> bridge -> HTTP
adapter -> production POST -> real combo executes with mocked provider fetch.
Both fallback success and two-target aggregate must fail before the fix and pass
after it. Assert raw request byte equality and forwarding auth headers. Hold the
second provider response behind a barrier past the old window and verify caller
pending, no premature headers, and original application signal not aborted.
Final acceptance uses auto/coding_high_tools:free, stream:false, max_tokens:64
and exactly one lookup_status tool. Fixtures contain two distinct free models
with tool capability and high coding fitness; no routing or scoring code changes.

Explicit deadline tests use each existing env input in an isolated resolver/module
instance and expect api_bridge_timeout 504 through real sockets. Config tests
cover defaults, blank/invalid values and explicit zero. Noninference retains its
old timeout. A real client disconnect after body completion must close the
application connection and propagate cancellation without a later Auto attempt.
Direct route success/aggregate tests remain unchanged in purpose.
Explicit socket tests configure the existing envs to resolve to 100 ms, with no
native timer scaling. The cancellation test also disables scaling so a proxy
timeout cannot conceal a forwarding leak.

## Release state

Keep this package local and unarchived. Parent owns root completion.review and
openspec/TODO.md integration. No deployment or historical incident attribution is
part of this package.
