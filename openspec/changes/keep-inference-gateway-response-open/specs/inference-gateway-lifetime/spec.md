## ADDED Requirements

### Requirement: Backend owns implicit inference lifetime

The gateway SHALL disable its implicit forwarding socket timeout for requests
that POST to the exact endpoints /v1/chat/completions, /chat/completions,
/v1/responses, /responses or /v1/messages, allowing an optional trailing slash
and ignoring the query, after the existing gateway path admission. GET,
subresources and SSE Accept alone SHALL NOT qualify. This shared transport default SHALL cover Auto combos regardless of saved name and SHALL NOT
require reading or changing the request body.

#### Scenario: Next target succeeds beyond the former gateway window

- **GIVEN** an auto/coding_high_tools:free nonstream request with max_tokens 64 and one tool
- **WHEN** the first target times out and the next target completes after the former implicit forwarding window
- **THEN** the HTTP caller remains connected with its signal unaborted and receives the exact successful assistant message

#### Scenario: Exhaustion beyond the former gateway window

- **WHEN** two distinct eligible Auto targets time out after the former implicit forwarding window
- **THEN** the caller receives the backend aggregate status and body naming both targets, rather than api_bridge_timeout

### Requirement: Preserve explicit transport policy and transparent forwarding

The gateway SHALL retain existing configured forwarding timeout behavior when any
of REQUEST_TIMEOUT_MS, API_BRIDGE_PROXY_TIMEOUT_MS or
API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS has a nonblank value. The existing resolver's
validation, precedence and explicit-zero max rule SHALL remain intact.
Noninference forwarding and incoming request/header/keepalive/socket settings
SHALL remain unchanged. Request bytes and auth forwarding SHALL remain intact.

#### Scenario: Configured forwarding deadline expires

- **WHEN** an inference request exceeds an explicitly configured forwarding socket timeout
- **THEN** the gateway returns HTTP 504 with api_bridge_timeout using the existing timeout resolution

#### Scenario: Noninference uses the existing default

- **WHEN** a noninference request has no explicit timeout override
- **THEN** its forwarding socket timeout remains 600000 ms

#### Scenario: Transparent body forwarding

- **WHEN** JSON bytes with arbitrary whitespace and an authorization header cross the bridge
- **THEN** the application receives identical bytes and the original authorization header

### Requirement: Caller cancellation closes forwarding

When the caller disconnects before the response finishes, the gateway SHALL
destroy its application connection even after the request body was fully received.

#### Scenario: Disconnect during a target attempt

- **GIVEN** the complete request body has reached the application and a provider attempt is pending
- **WHEN** the actual client disconnects
- **THEN** the application connection closes, cancellation reaches the pending attempt, and no later Auto attempt starts

### Requirement: Preserve query and explicit forwarding policy

The gateway SHALL retain its legacy path/Accept max(proxy, server request) rule
for other operations and all explicitly configured deadlines, including GET
requests accepting text/event-stream. Ordinary noninference JSON requests SHALL
retain proxyTimeoutMs. Anthropic messages count_tokens SHALL NOT be treated as
an inference operation.

#### Scenario: Models query accepts SSE

- **WHEN** GET /v1/models accepts text/event-stream with no explicit timeout
- **THEN** the native forwarding timeout remains 600000 ms

#### Scenario: Models query retains explicit server request maximum

- **WHEN** GET /v1/models accepts text/event-stream and API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS is 900000
- **THEN** the native forwarding timeout remains 900000 ms
- **AND** the same query accepting application/json retains proxyTimeoutMs

#### Scenario: Anthropic Auto inference

- **GIVEN** /api/v1/messages POST forwards its unchanged Auto model to handleChat
- **WHEN** POST /v1/messages has no explicit forwarding override
- **THEN** its implicit forwarding timeout is zero
- **AND** POST /v1/messages/count_tokens and GET /v1/messages retain legacy timeouts
