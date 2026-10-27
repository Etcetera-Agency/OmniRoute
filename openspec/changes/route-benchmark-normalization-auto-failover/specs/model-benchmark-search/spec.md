## MODIFIED Requirements

### Requirement: Process free-web results through high free Auto Structured Output

After `/v1/search` returns candidates for a complete exact miss, the system
SHALL process them through the ordinary chat handler using exactly
`auto/general_high_so:free`, with strict JSON Schema Structured Output and
`reasoning_effort: "high"`. It SHALL NOT pin a specific model, provider, or
connection, set `x-omniroute-connection`, or use the one-shot benchmark
dispatch. The recognized built-in Auto channel SHALL take precedence over a
saved combo with the same exact name. The ordinary Auto route SHALL select and
retry only eligible targets
within that requested channel, including moving to the next eligible target
after a transient HTTP 429 under its established cooldown rules.

The request SHALL retain the high band, free tier, and mandatory Structured
Output capability for every target. Strict zero-cost admission SHALL remain
enabled. Before dispatch, the processor SHALL verify that Auto bands are
enabled and persisted `freeAccessPolicy` is exactly `strict`; if either check
fails or cannot be read, it SHALL block inference. If no eligible target
remains, the request SHALL fail closed and remain unrated; it SHALL NOT remove
`:free`, remove `so`, downgrade the band, use a paid target, leave the requested
channel, or use the global fallback. Reasoning, task, hook, or web-search model
rewrites SHALL fail closed before inference when they change an explicit free
Auto channel. Extracted records SHALL remain
candidate-review-required and SHALL NOT update production scores.

#### Scenario: A transient 429 advances through the normal Auto pool

- **GIVEN** the high/SO/free Auto pool contains multiple eligible targets
- **AND** the first target returns a transient HTTP 429
- **WHEN** the benchmark normalizer dispatches its strict-schema request
- **THEN** the ordinary Auto attempt loop may try the next eligible target
- **AND** each attempt remains in `auto/general_high_so:free`
- **AND** every target passes the strict zero-cost and Structured Output gates
- **AND** the scorer does not send a separate pinned retry

#### Scenario: A saved combo cannot shadow the built-in free channel

- **GIVEN** a saved combo has the exact name `auto/general_high_so:free` and
  contains a paid target
- **WHEN** the benchmark normalizer dispatches
- **THEN** the recognized built-in high/SO/free Auto route is used
- **AND** the saved paid target is not attempted

#### Scenario: A routing rule cannot rewrite an explicit free Auto channel

- **GIVEN** a reasoning rule maps the requested free Auto channel to a paid model
- **WHEN** the chat handler applies routing policies
- **THEN** it rejects the request before any provider call
- **AND** it does not silently bypass the rule or leave the free band

#### Scenario: Exhausted Auto route defers without bypassing cooldown

- **GIVEN** the normal Auto route returns HTTP 429 after its eligible targets
  have been attempted
- **WHEN** the benchmark queue stores the result
- **THEN** it preserves the route response's retry headers when present
- **AND** it uses the existing bounded queue deferral when no header is present
- **AND** it issues no immediate duplicate inference request
- **AND** collected search evidence remains review-required and unrated

#### Scenario: No high/SO/free target fails closed

- **GIVEN** the requested high/SO/free Auto pool has no eligible target
- **WHEN** the benchmark normalizer dispatches
- **THEN** no model provider is called
- **AND** the row remains unrated with a blocked/error receipt
- **AND** no band, capability, tier, or provider fallback is used

#### Scenario: Strict free routing prerequisites are unavailable

- **GIVEN** Auto bands are disabled, `freeAccessPolicy` is not `strict`, or
  settings cannot be read
- **WHEN** the benchmark normalizer dispatches
- **THEN** it records a blocked unrated result
- **AND** it sends no model request

#### Scenario: Valid strict output becomes review-required evidence only

- **GIVEN** the normal Auto route returns a valid strict-schema response
- **WHEN** identity, returned URL, and literal source-quote validation pass
- **THEN** extracted fields are stored as candidate-review-required evidence
- **AND** no production rating or score-map write occurs

#### Scenario: Invalid strict output remains unrated

- **GIVEN** the normal Auto route returns malformed or mismatched output
- **WHEN** validation fails
- **THEN** the row receives a bounded error receipt
- **AND** the scorer does not retry by pinning another model or connection
