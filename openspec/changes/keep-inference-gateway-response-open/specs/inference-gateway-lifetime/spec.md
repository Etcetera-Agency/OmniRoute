## ADDED Requirements

### Requirement: Configure gateway lifetime through upstream settings

Production SHALL configure API_BRIDGE_PROXY_TIMEOUT_MS=0 and
API_BRIDGE_SERVER_REQUEST_TIMEOUT_MS=0 through persistent Compose environment.
REQUEST_TIMEOUT_MS SHALL remain unset. The upstream timeout resolver and gateway
forwarding selection SHALL remain unchanged. No custom timeout resolver,
response-close cancellation, or SSE cleanup code SHALL be added. These settings
are deployment-wide.

#### Scenario: Fallback succeeds after the former forwarding window

- **GIVEN** both native gateway settings are zero and an Auto freeband request
  with stream false, max_tokens 64, and one tool
- **WHEN** the first candidate times out and the next succeeds beyond the former forwarding window
- **THEN** the caller receives the backend successful assistant response

#### Scenario: Candidate pool is exhausted

- **WHEN** both eligible free candidates time out
- **THEN** the caller receives the backend aggregate naming both candidates

#### Scenario: Provider defaults stay unchanged

- **WHEN** only the two gateway settings are zero
- **THEN** provider timeout configuration equals the unconfigured upstream defaults

### Requirement: Preserve upstream explicit deadlines and forwarding

Positive configured deadlines SHALL retain upstream precedence and timeout error
responses. Request bytes, authorization, existing path/Accept behavior, and
native cancellation behavior SHALL remain unchanged. No request-body inspection
or inference classifier SHALL be added.

#### Scenario: Explicit forwarding deadline

- **WHEN** a request exceeds a configured positive forwarding deadline
- **THEN** the caller receives the existing api_bridge_timeout 504

#### Scenario: Transparent forwarding

- **WHEN** a request crosses the bridge
- **THEN** backend body bytes and authorization match the caller request
