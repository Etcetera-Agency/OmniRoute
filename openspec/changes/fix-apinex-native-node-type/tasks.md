# Implementation tasks

## 1. Proposal and failing regressions

- [x] 1.1 Verify the current provider-node create schema, DB row shape, and
      strict candidate identity against source at base `e5be44c4080f228bc022ac9f821e073faddf80a8`.
- [x] 1.2 Add RED sync coverage for the deployed node with stored type
      `openai-compatible`, `apiType = "chat"`, exact full ID, endpoint,
      prefix/connection, and 44 synced raw IDs. Add rows for each other
      schema-valid API format under the same stored type. The deployed
      `e5be44c` selector fetched models.dev but skipped APInex.
- [x] 1.3 Assert all API formats keep stored type, full node ID/raw model exact
      matching, prefix mismatch, 21 explicit zero rows, 23 paid rows,
      Anthropic/different-endpoint rejection, unchanged synced records, and
      hidden override.

## 2. Implementation

- [x] 2.1 Select only the stored `openai-compatible` type and retain the exact
      endpoint and full node ID binding; do not infer type from API format or
      generated ID prefix.
- [x] 2.2 Run Code Simplifier on the changed source and tests; apply only
      behavior-preserving simplification.

## 3. Verification and remaining acceptance

- [x] 3.1 Run the focused APInex zero-price and models.dev sync tests, strict
      OpenSpec validation, changed-file formatting, and `git diff --check`.
- [x] 3.2 Obtain a fresh independent review of the stored-type/API-format
      distinction and resolve any concrete findings.
- [x] 3.3 Record implementation, RED/GREEN, review, and limitations in this
      package's `completion.review` and the root `completion.review`.
- [x] 3.4 Keep deployed-source verification and native free-only live
      acceptance in `openspec/TODO.md`; do not infer them from source tests.
