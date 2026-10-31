# Current scope correction (2026-10-31)

- [x] Remove separate Auto repeat budget and restore native total accounting.
- [x] Remove gateway response-close cleanup and associated test.
- [x] Restore upstream timeout resolver and forwarding implementation; use native gateway settings.
- [ ] Complete passive runtime acceptance after the authorized artifact retry;
      record exact evidence in `openspec/TODO.md` before archive.

Earlier tasks below are historical implementation receipts; rejected source changes
are superseded by the current design/spec and scope correction above.

## 1. Specification

- [x] 1.1 Record the selected transport contract, pseudocode and scenarios; validate strictly.

## 2. Regression

- [x] 2.1 Add bridge-to-production-POST fallback and aggregate regressions while retaining direct tests; capture RED.
- [x] 2.2 Cover explicit deadlines, noninference defaults, raw bytes/headers and real caller disconnect.

## 3. Implementation

- [x] 3.1 Derive canonical inference timeout and consume it in the bridge.
- [x] 3.2 If proven by disconnect regression, destroy unfinished forwarding on caller response close.

## 4. Verification

- [x] 4.1 Apply Code Simplifier review, run focused tests and strict validation, and record exact evidence.
- [x] 4.2 Leave the package implemented/unarchived for parent integration review.
- [x] 4.3 Keep bridge, lifetime and timeout-policy coverage in fork-owned tests; leave tracked upstream tests unchanged.
- [x] 4.4 Run final five-file fork test command after EX006-lockout completes; 45/45 passed, zero failures/skips/cancellations. Log: `/tmp/omni-auto-final-fork-node.log`.

## 5. Independent review P2

- [x] 5.1 Correct chosen method/path policy and source-ground messages support before code.
- [x] 5.2 Capture RED for SSE models/default and explicit max, exact POST/path classification.
- [x] 5.3 Apply minimal classifier correction, retain real caller tests, review with Code Simplifier and record GREEN.
