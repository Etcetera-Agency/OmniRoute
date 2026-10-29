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
