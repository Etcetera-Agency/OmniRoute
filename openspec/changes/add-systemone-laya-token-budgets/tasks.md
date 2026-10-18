# Implementation Tasks

## 1. Failing tests first

- [x] 1.1 Schema tests: accept omitted fields and positive integers; reject
      booleans, fractions, zero, negatives, `head_max_len` without `max_len`, and
      `head_max_len > max_len` with field-specific errors.
- [x] 1.2 Configuration tests: default ceiling is `8192`; valid positive safe
      integer `LAYA_MAX_TOKEN_BUDGET` is honored; invalid values use `8192`.
- [x] 1.3 Dispatch tests: pinned Laya receives supplied fields; pinned
      TypeSafe/OpenRouter and every chain attempt omit them; absent fields preserve
      exact existing serialized body bytes.
- [x] 1.4 Route tests: a `max_len` above the configured ceiling returns the
      existing 400 envelope before API-key policy or dispatch.

## 2. Implementation

- [x] 2.1 Read the Laya token ceiling in SystemOne config.
- [x] 2.2 Validate budget fields and the paired-field rule in the request
      parser, using the configured ceiling before auth.
- [x] 2.3 Add budgets only to explicit pinned Laya request bodies.
- [x] 2.4 Update API/environment docs and `.env.example`.
- [x] 2.5 Update `completion.review` and `openspec/TODO.md` with verification
      and the deferred native/live acceptance gate.

## 3. Verification and operational follow-up

- [ ] 3.1 Run focused SystemOne tests, `npm run test:all`, lint, core/OpenSSE
      typechecks, docs checks, and strict OpenSpec validation.
- [ ] 3.2 Run Code Simplifier and an independent review; fix findings and
      rerun affected checks.
- [ ] 3.3 After integration onto the approved current source, build and run the
      authorized native/production acceptance. Verify pinned Laya receives the
      requested values, invalid values stop before dispatch, and configured
      ceilings reject over-budget requests. Keep this package open until that gate
      passes; record all deferred work in `openspec/TODO.md`.
