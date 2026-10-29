## ADDED Requirements

### Requirement: Repaired OpenSSE modules have unique TypeScript bindings

The `open-sse/services/combo/resolveAutoStrategy.ts` and
`open-sse/utils/opencodeHeaders.ts` production modules SHALL contain no duplicate
TypeScript bindings that produce TS2300 diagnostics.

#### Scenario: Focused duplicate-binding check

- **GIVEN** the TypeScript compiler checks both affected production modules
- **WHEN** it binds their imports and declarations
- **THEN** neither module produces a TS2300 duplicate-identifier diagnostic
- **AND** the focused regression test passes without depending on module resolution or
  compiling unrelated application modules
