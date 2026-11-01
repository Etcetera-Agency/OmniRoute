# Implementation tasks

> Final acceptance: 2026-11-01. Earlier holds below are historical and resolved;
> see the final acceptance receipt in `completion.review`.

## Proposal and RED regressions

- [x] 1.1 Record owner decisions, exact scope, and selected behavior in proposal
      and detailed pseudocode.
- [x] 1.2 Add the mapped-provider collision regression and capture RED for
      zero-to-nonzero, nonzero-to-zero, and earlier-only model behavior.
- [x] 1.3 Update the fork-owned stale evidence and raw provider mapping tests.
- [x] 1.4 Update compatible-pricing stale expectations and capture RED for old
      complete consistent zero-price snapshots across eligible connections.

## Implementation

- [x] 2.1 Remove the fork-owned 36-hour expiry from models.dev snapshot reading
      and strict evidence lookup; preserve malformed/future timestamp rejection
      and original `fetchedAt`.
- [x] 2.2 Map raw models.dev provider IDs through `mapProviderId()`, select the
      last mapped raw provider's evidence model set, and require exact zero
      source prices plus explicit effective native zero prices.
- [x] 2.3 Remove only age-based rejection from compatible pricing composition;
      retain timestamp validity, exact active eligible connections, complete
      per-model coverage, consensus, and independent capability behavior.
- [x] 2.4 Run Code Simplifier over changed implementation and tests.

## Verification and follow-up

- [x] 3.1 Run all directly related regression files, focused lint, strict
      OpenSpec validation, formatting, and `git diff --check`.
- [x] 3.2 Correct this package's root TODO and append the final local receipt to
      root `completion.review`, preserving parent-owned text.
- [x] 3.3 Keep package unarchived and without an implementation-complete marker
      while deployment/passive native metadata and candidate acceptance remain
      open. Provider/model inference is prohibited, not a required acceptance gate.

## Final acceptance and archive authorization (2026-11-01)

Parent accepted source, prior scoped regressions/reviews, and actual runtime
release `dcc79e26476434ef0e0bcb5d49be50798c58c0fd` on immutable image
`sha256:52d86f2c8b9847088a5e2b37ac7c5a82a429a6f1ff22f6cfed5014ab140407e7`.
Attempt 2 succeeded; the owner selected stock automatic credential-health checks.
Earlier runtime/health holds are resolved. Historical manual inference, queue,
normalization, forced-tool, and billing work remains suspended and is not a
package-closure requirement. This closure ran no source tests or runtime actions.
