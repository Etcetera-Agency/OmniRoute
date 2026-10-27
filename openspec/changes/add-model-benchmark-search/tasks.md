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
- [x] 1.6 Add failing tests for one-row-at-a-time claims, immediate row
      completion, and preserving discovery evidence when strict-SO times out.
- [x] 1.7 Add failing tests that a fresh `running` row schedules retry at its
      stale boundary and becomes claimable after that boundary.
- [x] 1.8 Add a failing regression proving exhausted rows are terminally cleaned
      before source snapshots load, with claim/list/eligibility predicates aligned.
- [x] 1.9 Add a failing regression proving an exact AA/official match blocks
      discovery search when the direct evidence has no usable fitness score.

## 2. Implementation

- [x] 2.1 Add the idempotent queue/evidence migration and DB-domain operations.
- [x] 2.2 Implement bounded AA, SWE-bench, Terminal-Bench 2.0/2.1, DeepSWE,
      HF eval metadata, and explicit zero-cost Ollama Search source client.
- [x] 2.3 Keep durable discovery-queue operations separate from models.dev
      synchronization. Normal sync refreshes the full current benchmark
      catalog and does not enqueue identities or start a queue drain; the
      existing explicit queue path retains sequential claims and retry receipts.
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
- [x] 2.8 Claim and finish one queue row at a time; persist each result before
      claiming another. Bound and abort strict-SO at five minutes while keeping
      collected search evidence review-required and unrated on timeout.
- [x] 2.9 Schedule stale-running recovery at the existing 15-minute retry
      boundary without changing the daily models.dev sync cadence.
- [x] 2.10 Clean max-attempt rows before checking claimable work so terminal
      cleanup does not trigger another source refresh.
- [x] 2.11 Finish exact-match/no-score rows as review-required without HF or web
      search, preserving the complete-miss search boundary.

## 2. Rate-limited free-SO recovery

- [x] 2.12 Add failing regressions for 429 retry headers, persisted queue pause,
      explicit Ollama Search and exact-free retry, no strict-SO after search
      failure, exact no-credentials without attempt consumption, and repeated
      HTTP 429 stopping at the existing attempt maximum.
- [x] 2.13 Add 15-second spacing for explicit Ollama Search and five-second
      spacing for actual strict-SO calls; durably defer search/normalizer HTTP
      429 and the exact search no-credentials error.
- [x] 2.14 Preserve collected search evidence and review-required gating during
      deferral; never write search-extracted fitness or select a fallback.
- [x] 2.15 Apply Code Simplifier, update completion review and repo TODO,
      then run focused tests and migration checks.
- [x] 2.16 Preserve the strict-SO connection selected before a 429 across all
      deferred retries; if it is no longer active and exact-free, stop without
      dispatching on another connection.

## 3. Verification and acceptance

- [x] 3.1 Run focused RED/GREEN tests (34/34 pass) and `typecheck:core`; the
      repository-wide check reports 757 errors in other files, with none in
      this diff.
- [x] 3.2 Check OpenSpec validation availability; the CLI is unavailable in this
      worktree, so strict package validation remains unverified.
- [x] 3.3 Verify migration rollback description, `git diff --check`, and that
      frozen score map files are unchanged.
- [x] 3.4 Independently review configured Ollama credentials, explicit
      zero-cost provider selection/no alternate, exact-match search boundary,
      and pinned strict-SO provider/model path; follow-up review found no
      remaining findings.
- [ ] 3.4a Verify live endpoint metadata, exact free connection, internal-key
      availability, and search quota through read-only checks before inference.
- [x] 3.5 Apply Code Simplifier, update `completion.review` and
      `openspec/TODO.md`, then commit this local package. Do not build a separate
      local image.
- [ ] 3.5a After owner-approved integration, follow the authorized PR/main
      deployment path; no PR, merge, deployment, or runtime action is part of
      this local implementation package.
- [ ] 3.6 After deployment, run one controlled search-plus-strict-SO request.
      Record client requests and provider attempts separately, exact model and
      connection, output validation, route, zero cost, and absence of fallback.
- [ ] 3.7 Record the provider's live monthly quota and remaining search capacity
      before allowing the full-catalog worker to consume its allowance.
- [ ] 3.8 Verify the stuck-row recovery cases, focused suite, independent review,
      and controlled live search/SO receipt after deployment.
- [ ] 3.9 Verify live rate-limit reset handling and one successful strict-SO
      response through the same free model/connection, with zero paid or
      out-of-band attempts.

## 4. Proven evidence identity and catalog eligibility correction

- [x] 4.1 Add RED regressions using the verified AA payload shape: persist both
      `AA Coding` and `AA Intelligence` from one row, retain both metric values,
      and prove fitness recomputation sees both observations.
- [x] 4.2 Add RED regressions proving a complete direct-source miss skips both
      HF and Ollama Search when no active synced provider model ID matches after
      case folding; exact case-folded catalog match preserves the current HF
      route and provider selection.
- [x] 4.3 Include `benchmark` and `metric` in the existing evidence fingerprint
      and fail closed on a model ID absent from `getAllActiveSyncedModels`,
      persisting an auditable unrated eligibility reason.
- [x] 4.4 Run focused benchmark-search and fitness-recompute tests, review the
      diff with Code Simplifier, and update this review plus `openspec/TODO.md`.
- [x] 4.5 The complete five-feed refresh replaces legacy direct-source sets
      from current inputs, including both AA metrics. Migration 200 drops every
      legacy raw payload, so it does not replay archived AA JSON.
- [x] 4.6 Make a complete current AA refresh recreate both benchmark metrics
      from the source and prove repeated current-set replacement is idempotent;
      migration 200 does not replay archived raw payloads.
- [ ] 4.7 Record local package review, approved integration/release, migration
      rehearsal, live acceptance, and current-source refresh receipts before
      closure.
- [x] 4.8 Keep an internal direct-refresh operation with explicit catalog input,
      full source validation, current-set replacement, and native fitness
      publication. The full-catalog input and normal-sync hook are completed in
      tasks 6.3–6.5.
- [x] 4.9 Keep the bundled maintenance operator and runtime dependency check.
      Its former active-provider-only input is superseded by task 6.3's full
      canonical catalog input; do not use the older path for fitness refresh.
- [x] 4.10 Add tests for no search-run/job, search, or normalizer calls; exact
      identity receipts; incomplete-source reporting; evidence persistence
      under runtime IDs; nonclaimable identity status and drain exclusion; and
      global profile publication. Include more than 108 active IDs to catch
      truncation.
- [x] 4.11 The prior active-only release operation is superseded by task 6.10.
      Do not run it as the catalog-wide fitness refresh; use the full canonical
      current-snapshot operation after approved integration.
- [x] 4.12 Prove direct reprocessing feeds the actual free-band consumer using
      raw catalog `model.id` for both `coding_high_tools:free` and
      `general_high_tools:free`, while keeping `${providerId}/${modelId}` only
      as the route-facing model string.

## 5. Final-image direct operator runtime packaging

- [x] 5.1 Add an artifact-level RED test that builds the one-shot operator and
      loads that exact bundle in the final runtime dependency tree. The test
      must fail on the observed unresolved `@aws-sdk/client-bedrock-runtime`
      import, rather than relying on syntax checks, help output, or source-only
      tests. Keep the smoke before active-catalog reads, source fetching,
      database work, queue work, search, or inference.
- [x] 5.2 Trace the unresolved package from the operator entry through the
      bundled import graph and make the smallest evidence-backed packaging
      change so every required runtime import resolves in the final image.
      Preserve direct-only reprocessing semantics and avoid retaining
      inference-only runtime packages when the trace proves they are unused.
- [x] 5.3 After the operator bundle is copied into the final runtime stage,
      run the same side-effect-free module-load smoke in that stage and fail
      image packaging on any unresolved runtime import. The check must not
      access production data or make network/provider calls.
- [x] 5.4 Run the artifact smoke and existing direct-reprocessing functional
      tests; prove the RED failure and GREEN result. Confirm no queue/search/
      normalizer calls or production DB writes are possible in the smoke mode.
- [x] 5.5 Apply Code Simplifier; update `completion.review` and
      `openspec/TODO.md` with the deployed-image failure, source import cause,
      local fix, test evidence, review result, and remaining release gates;
      obtain independent review before local commit.
- [ ] 5.6 Build the authoritative ARM64 final image after integration and
      retain its final-stage direct-operator smoke receipt; this worktree cannot
      run that image build on its AMD64 host.

## 6. Full-catalog current benchmark snapshot and native publication

- [x] 6.1 Add a detailed design and RED regressions before implementation for
      full canonical catalog enumeration, exact raw/unique-name matching,
      current-set replacement, all-source fail-closed behavior, atomic native
      base/profile replacement, HF/queue set replacement, and migration 200.
- [x] 6.2 Add migration 200 to rename
      `model_benchmark_search_evidence` to `model_benchmark_evidence` while
      preserving rows, FK cascade, uniqueness, and indexes. Fresh databases
      SHALL finish with only the new table; repeated initialization SHALL not
      recreate the old table or compatibility view.
- [x] 6.3 Replace the active-provider-only direct operator's catalog input with
      all distinct canonical `model_capabilities` IDs and names. Require every
      AA/official source to be complete and nonempty before writes; match exact
      raw IDs first, then unique exact names in the canonical catalog.
- [x] 6.4 Persist only current formula observations. A valid complete source
      refresh SHALL replace its source set, changed values SHALL replace prior
      values, omitted rows SHALL be deleted, and distinct current benchmark,
      harness/version, metric, effort, and configuration observations SHALL be
      retained. Do not persist raw payload or changed-value history.
- [x] 6.5 Atomically replace all five direct-source sets and the owned native
      `benchmark_fitness` base plus low/medium/high sources for every canonical
      raw ID. Clear stale owned keys and evidence for removed catalog IDs;
      preserve current non-direct observations for IDs still in catalog and
      preserve `user_override`, arena, and unrelated sources. Publish only after
      all five direct feeds validate; no readiness-marker table is required.
- [x] 6.6 Update successful HF and queued source/model writers to replace their
      current observation sets, including valid empty results. Failed,
      malformed, timed-out, or incomplete source responses SHALL preserve the
      last valid set. Keep active-only discovery/search gates unchanged.
- [x] 6.7 Test the legacy migration transition without inventing source
      boundaries: migration 200 renames the table, removes `raw_json` for every
      source, and retains only the latest row for each exact existing formula
      observation key using the reader's capture/hash ordering. Distinct keys
      remain; legacy deleted keys and successful empty outcomes cannot be
      reconstructed. Compare formula output before and after migration.
- [x] 6.8 Prove a raw canonical ID maps through native `model_intelligence` to
      the unchanged actual free coding/general high-band consumer while
      `candidate.modelStr` remains provider-prefixed. Prove inactive canonical
      IDs are included without creating search work or provider calls.
- [x] 6.9 Run final combined regression suites and built-operator
      `--check-runtime`, Code Simplifier, independent review, and strict OpenSpec
      validation. Record results and remaining release gates in
      `completion.review` and repo-level `openspec/TODO.md` before commit.
- [ ] 6.10 Release order: merge this fix, apply the exact upstream v3.8.52
      update, then rehearse migration 200 on a consistent isolated production
      DB clone with the upgraded runtime dependencies. Assert renamed schema,
      no raw payload column, formula-key compaction, unchanged eligible
      outputs, FK/integrity checks, and rollback by restoring the pre-migration
      copy with the prior image. Do not build any image until the update and
      rehearsal pass. Then build one authoritative ARM64 image, pause startup
      sync/queue work during maintenance, run one complete full-catalog refresh,
      and retain immutable image/source and current-set receipts. Do not run
      discovery, search, or inference as part of this direct refresh.
