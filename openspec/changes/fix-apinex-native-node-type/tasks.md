# Implementation tasks

## 1. Proposal and failing regressions

- [x] 1.1 Verify the current provider-node create schema, DB row shape, and
      strict candidate identity against source at base `e5be44c4080f228bc022ac9f821e073faddf80a8`.
- [x] 1.2 Add a RED sync regression using the sanitized native APInex node
      (`type = "openai-compatible"`, exact full ID/endpoint/prefix/connection,
      and 44 synced raw IDs). Assert the existing catalog fetch and persistence
      were missing before the selector fix.
- [x] 1.3 Assert full node ID/raw model exact matching, prefix mismatch, 21
      explicit zero rows, 23 paid rows, other node-type/endpoint rejection,
      unchanged synced records, and unchanged separate hidden override.

## 2. Implementation

- [x] 2.1 Select only the exact native APInex type and retain the exact endpoint
      and full node ID binding; do not add a compatibility type branch.
- [x] 2.2 Run Code Simplifier on the changed source and tests; apply only
      behavior-preserving simplification.

## 3. Verification and remaining acceptance

- [x] 3.1 Run the focused APInex zero-price and models.dev sync tests, strict
      OpenSpec validation, changed-file formatting, and `git diff --check`.
- [x] 3.2 Obtain a fresh independent source review and resolve any concrete
      findings.
- [x] 3.3 Record implementation, RED/GREEN, review, and limitations in this
      package's `completion.review` and the root `completion.review`.
- [x] 3.4 Keep deployed-source verification and native free-only live
      acceptance in `openspec/TODO.md`; do not infer them from source tests.
