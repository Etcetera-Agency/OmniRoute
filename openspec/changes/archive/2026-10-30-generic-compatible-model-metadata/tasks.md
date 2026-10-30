# Implementation tasks

## 1. Failing regressions

- [x] 1.1 Add documented-shape fixtures for both native node types: standard
      OpenAI model-list rows and Anthropic model rows with `display_name`,
      nested `capabilities`, token limits, and cursor pagination.
- [x] 1.2 Add endpoint and schema tests for default paths, existing relative
      paths, same-origin absolute endpoints, and create/update validation;
      reject cross-origin endpoints before forwarding credentials.
- [x] 1.3 Add normalization tests for exact raw IDs, display names, explicit
      true/false capabilities, token limits, hidden state, and per-connection
      exclusions, and no provider/model activation from metadata.
- [x] 1.4 Add current-snapshot tests for explicit per-million zero/nonzero
      prices, unknown or malformed units, duplicate-ID conflicts, valid empty
      replacement, failed or incomplete preservation, original timestamp
      retention, and expiry.
- [x] 1.5 Add reader and save tests for exact provider/connection/raw-ID
      binding, multi-connection ambiguity failing closed, and compatible price
      survival across models.dev namespace replacement; verify evidence reads
      perform no network request or source write.
- [x] 1.6 Add a regression proving compatible metadata refresh failure does not
      fail a successful models.dev pricing/capability sync and does not refresh
      prior source age.

## 2. Shared implementation

- [x] 2.1 Add one common compatible metadata record/parser and current-snapshot
      store. Reuse existing model normalization and persistence; do not add a
      factory, strategy registry, or provider-specific branch.
- [x] 2.2 Use one configured model-endpoint URL builder from compatible
      validation and discovery. Preserve defaults and relative paths; restrict
      absolute URLs to the configured base origin.
- [x] 2.3 Route both native node types through the shared persistence path.
      Preserve protocol-specific authentication, complete pagination, and
      existing fallback behavior without labeling partial results complete.
- [x] 2.4 Refresh only active compatible nodes using the existing periodic
      model-sync lifecycle with bounded per-node failures.
- [x] 2.5 Merge only fresh, explicit, exact, unambiguous compatible prices into
      current pricing and strict-zero evidence. Preserve models.dev precedence
      when compatible evidence is absent or ambiguous.
- [x] 2.6 Remove provider-branded collector code, hooks, and storage namespace;
      retain no compatibility shim or legacy source data reader.
- [x] 2.7 Mark superseded provider-specific OpenSpec requirements inactive;
      preserve their completion receipts and add current follow-ups to root
      `openspec/TODO.md`.

## 3. Verification and handoff

- [x] 3.1 Observe the focused regressions fail before implementation, then pass
      after implementation.
- [x] 3.2 Run focused tests, changed-file lint and baseline-compared typecheck,
      `git diff --check`, and strict validation for this OpenSpec change.
- [x] 3.3 Run Code Simplifier before commit. Record any fix and its review in
      the root `completion.review`.
- [x] 3.4 Obtain a fresh independent review of the combined diff and resolve
      actionable findings.
- [x] 3.5 Commit locally only. Keep GitHub build/release, deployment, and live
      compatible-provider acceptance in `openspec/TODO.md`.

## 4. Merged-runtime import regression

- [x] 4.1 Add a source import-graph regression for the cycle observed on main
      `0c316b9`; prove it fails before the helper boundary change.
- [x] 4.2 Move pure endpoint and compatible URL normalization helpers below
      provider validation/runtime modules; update callers without a compatibility
      shim and preserve exact URL behavior.
- [x] 4.3 Keep `--check-runtime` evaluating the emitted operator module. Run the
      focused source import regression and the existing compatible, pricing,
      capability, and benchmark suite; do not build the operator locally.
- [x] 4.4 Trace the remaining import-time DB path after the cycle is removed.
      Record its pre-existing source edge in root/package reviews and keep
      runtime-check semantics unchanged.
- [x] 4.5 Run focused compiler/static checks and strict OpenSpec validation;
      compare repository-wide typecheck diagnostics with the clean base if red.
      Apply Code Simplifier to the complete correction before review.
- [x] 4.6 Obtain fresh independent review, resolve actionable findings, and
      commit locally. Keep the generated-artifact GitHub check and live provider
      acceptance in `openspec/TODO.md`; section 6 records their later status.

## 5. Confirmed emitted initializer deadlock

- [x] 5.1 Add a source import-graph regression that fails on the current source
      because `contextManager` directly re-exports `comboContextLimit`; keep the one-way
      `comboContextLimit` dependency on `contextManager.resolveTokenLimit`.
- [x] 5.2 Remove the reverse module edge by deleting the `contextManager`
      re-export and updating production/test consumers to import
      `resolveComboContextLimit` directly from `comboContextLimit`. Add no
      compatibility export and change no context-limit calculation.
- [x] 5.3 Run the graph regression and existing combo/context-limit tests,
      focused lint/compiler checks, strict OpenSpec validation, and
      `git diff --check`. Do not build/transpile the application or operator
      locally; retain GitHub `--check-runtime` as the emitted-bundle gate.
- [x] 5.4 Apply Code Simplifier, update completion/TODO records, obtain fresh
      independent review, and commit locally. Track generated-bundle runtime,
      deployment, provider acceptance, and free-only acceptance as separate
      gates; section 6 records their later status.

## 6. Post-merge runtime and live acceptance (TL331–TL333, 2026-10-30)

- [x] 6.1 Verify GitHub ARM64 run `40969961834` on source
      `455442b057542c857425d986853745b16e244543`: build, emitted
      `--check-runtime` with `--network none`, parity, and published artifact.
- [x] 6.2 Verify protected deployment transaction `40969961834-1`, current
      image/config digest, healthy container, migration version 216, and paired
      protected pre-deploy DB/image rollback receipt in this package review.
- [x] 6.3 Verify current generic metadata sync and owner-directed APInex
      isolation. The current provider returned 44 models and 44 explicit price
      pairs; this does not prove an inference completion.
- [x] 6.4 Delete the restricted temporary key and diagnostic artifacts after
      use; confirm API 404, SQL zero key rows, deleted GitHub diagnostic
      artifacts, and removal of local extracted bundle copies.
- [x] 6.5 Complete one controlled forced-tool request through
      `auto/coding_high_tools:free`. Correlation
      `382a4b4f-3a76-4766-b7ff-9d5a5b17c189`, request
      `32879ca5-ab90-4c0d-b7d8-84929e3c173e`, response
      `52a490d8a4959b8c71caeb86437f1699`: `free/gemini-3.8-flash` on APInex
      connection `9565fb26-817c-42b4-baa0-b76733a951c4`, node
      `openai-compatible-chat-fbf9bf6f-8827-4330-a87d-9b5eaf4d30b1`; one
      client completion and one provider attempt, HTTP 200, 1,789 ms. Forced
      `acceptance_probe({"ready":true})` returned `ready=true`. Usage was 591
      input + 28 output = 619 tokens. Metadata fetched
      `2026-10-30T06:00:35.764Z` reported explicit `$0/$0` per-million prices
      and tools/vision. Computed cost from actual usage and explicit zero prices
      is `$0`; no `request_cost_ledger` row exists for this request, so no
      persisted cost is claimed. The successful controlled request made no paid
      or out-of-band attempts. Temporary key deletion
      returned 200; management GET returned 404 and SQL found zero key rows.
      This closes native free-only live acceptance.
- [x] 6.6 Record live Anthropic-compatible metadata discovery as a separate
      TODO follow-up. Current Anthropic support is fixture-tested; no live
      discovery was performed or claimed. The follow-up remains open in root
      `openspec/TODO.md`.
- [x] 6.7 Record the pre-existing import-time usage DB migration behavior and
      native availability-subreason diagnostics as deferred scope in root
      `openspec/TODO.md`; any behavior change requires a separately scoped
      decision and proposal.
