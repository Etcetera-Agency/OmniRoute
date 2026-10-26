## 1. Proposal and RED tests

- [x] 1.1 Add failing tests for first-sync baseline, later new identity trigger,
      non-dry-run/syncCapabilities gating, and retry-safe deduplication. The
      initial test run failed because the search module did not exist.
- [x] 1.2 Add failing source-client tests for exact matching, bounded pages,
      source-specific parsing, retry/error status, and incomplete AA pagination
      never counting as absence. The shared fetch helper also enforces a
      six-second abort timeout; the suite does not simulate that timer.
- [x] 1.3 Add failing orchestration tests proving exact missing from both AA and
      every official source is required before HF and explicit
      `ollama-search`; assert no alternate provider.
- [x] 1.4 Add failing persistence tests for raw evidence provenance, nullable
      effort/value, and duplicate suppression. Source review verifies that the
      authenticated read route uses `isAuthenticated` and the search module has
      no score-map write path.
- [x] 1.5 Add a failing regression proving scheduled discovery resolves the
      configured Ollama credential, selects only `ollama-search`, requires
      zero cost, and never falls back to another search provider. RED reproduced
      the missing Ollama search configuration; GREEN passes in the focused suite.

## 2. Implementation

- [x] 2.1 Add the idempotent queue/evidence migration and DB-domain operations.
- [x] 2.2 Implement bounded AA, SWE-bench, Terminal-Bench 2.0/2.1, DeepSWE,
      HF eval metadata, and explicit zero-cost Ollama Search source client.
- [x] 2.3 Trigger durable queueing from successful models.dev identity deltas
      before replacing the prior model capability snapshot; drain all eligible
      models sequentially and preserve retry/error receipts.
- [x] 2.4 Add authenticated read access for runs and raw evidence; keep all
      unverified/missing results pending and prevent score-map writes.
- [x] 2.5 Add a fail-closed strict-SO processor. It may infer only after each
      request re-verifies the exact free Phala endpoint and local free
      connection; pin one connection, disable retries/fallback, and keep all
      extracted evidence review-required and unrated.
- [x] 2.6 Apply Code Simplifier and update this change's completion.review.
- [x] 2.7 Replace keyless DuckDuckGo handler invocation with the shared
      explicit `ollama-search` execution path; stop before search if its
      registry price is nonzero and reject results with another provider or
      nonzero reported cost. Preserve strict-SO and unrated-evidence gates.

## 3. Verification and acceptance

- [x] 3.1 Run focused RED/GREEN tests (30/30 pass) and `typecheck:core`; the
      repository-wide check reports 757 errors in other files, with none in
      this diff.
- [x] 3.2 Check OpenSpec validation availability; the CLI is unavailable in this
      worktree, so strict package validation remains unverified.
- [x] 3.3 Verify migration rollback description, `git diff --check`, and that
      frozen score map files are unchanged.
- [x] 3.4 Independently review configured Ollama credentials, explicit
      zero-cost provider selection/no alternate, and the exact pinned strict-SO
      provider/model path; follow-up review found no remaining findings.
- [ ] 3.4a Verify live endpoint metadata, exact free connection, internal-key
      availability, and search quota through read-only checks before inference.
- [ ] 3.5 Commit after Code Simplifier; then use the owner-authorized PR/main
      deployment path. Do not build a separate local image.
- [ ] 3.6 After deployment, run one controlled search-plus-strict-SO request.
      Record client requests and provider attempts separately, exact model and
      connection, output validation, route, zero cost, and absence of fallback.
- [ ] 3.7 Record the provider's live monthly quota and remaining search capacity
      before allowing the full-catalog worker to consume its allowance.
