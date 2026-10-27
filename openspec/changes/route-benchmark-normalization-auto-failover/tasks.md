# Implementation Tasks

1. Add a failing regression proving normalization requests use
   `auto/general_high_so:free` through the ordinary chat handler, without a
   forced connection, provider pin, or one-shot bypass.
2. Route strict-SO normalization through the existing Auto candidate loop,
   preserving the schema, high reasoning intent, injection guard, and output
   validation.
3. Ensure a saved combo cannot shadow the exact recognized built-in Auto
   channel; add a regression proving a colliding paid combo target is not sent.
4. Reject routing-policy rewrites of explicit free Auto channels before any
   provider call; add a regression for a reasoning rule targeting a paid model.
5. Keep an empty recognized `auto/<band>:free` pool empty through later
   candidate expansion, even when the legacy full-pool fallback flag is set;
   add a regression proving the active provider catalog is not reintroduced.
6. Remove the exclusive pinned one-shot helper and its endpoint/connection
   checks if graph and reference searches confirm no other consumers.
7. Preserve final route-level 429 headers and existing queue deferral; verify
   no scorer-level immediate retry occurs.
8. Run focused normalizer and Auto 429 tests, relevant type checks, and
   formatting. Apply Code Simplifier and resolve independent review findings.
9. Update `completion.review` and `openspec/TODO.md` with code, test, review,
   and current live evidence before commit.
10. Merge through the authorized PR path, verify the main deployment, then run
    one controlled request through the high/SO/free Auto channel and confirm
    selected target, actual Structured Output, strict zero cost, and no
    out-of-band or paid attempts. Confirm scheduled benchmark queue progress
    from fresh live receipts before closing the change.
11. Let ordinary Auto retries finish within a twenty-minute normalizer deadline;
    defer its own HTTP 504 with the existing queue delay; keep the stale-row
    lease at twenty-five minutes; verify no duplicate or manually redirected
    request starts.
