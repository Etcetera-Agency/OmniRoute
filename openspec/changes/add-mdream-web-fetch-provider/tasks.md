# Implementation Tasks

Read [design.md](design.md) and [reuse.md](reuse.md) before implementation. Checked tasks have completed local checks; post-deployment acceptance remains open.

## 1. Capture the Failing Contract First

- [x] 1.1 Add focused executor/handler tests for M1/M3/M4: `mdream` dispatch, Markdown default, unsupported formats with zero calls, exact hosted URL and fixed headers, normalized metadata, upstream/empty/network/read/abort failures, deadline cleanup and rejected HTTPS destinations/query/data class.
- [x] 1.2 Add route/schema/MCP tests for M1/M2/M3: enum acceptance and MCP descriptions; explicit no-connection request; caller authentication preserved; scoped key without `noauth` denied; keyless-admitted scope accepted; incoming auth/cookies never forwarded; sensitive-health rejected; safe Mdream logging; automatic selection and quota fallback never attempt Mdream.
- [x] 1.3 Add catalog tests for M5: single usable fetch-kind Mdream entry without a connection, Markdown only, zero cost, unknown monthly quota, no new search/model entry, existing provider statuses preserved. Add UI coverage for the zero-cost claim and absent monthly quota. Record the focused red results before production edits.

## 2. Implement the Bounded Adapter

- [x] 2.1 Implement `open-sse/executors/mdream-fetch.ts` using R1/R2: existing public URL guard, HTTPS-only destinations, forbidden query names, REST data-class gate, fixed GET/header set, independent 20,000 ms deadline, sanitized errors, normalized text result. Add only relevant `AICODE-NOTE:` anchors for privacy/hosted contract. Verify M3/M4 tests.
- [x] 2.2 Register `mdream` in `WebFetchRequest`, `WEB_FETCH_PROVIDERS` and `handleWebFetch`; keep Markdown validation before upstream work. Verify M1 dispatch/format tests. Apply Code Simplifier to this implemented slice.

## 3. Integrate Explicit Keyless Admission

- [x] 3.1 Add Mdream to both current provider policy sets and REST/MCP enums. Reuse existing auth, `noauth` scope checks and explicit no-fallback behavior. Reject the data-class marker at the REST route; keep it out of upstream headers/body schema. Prevent raw URL logging for Mdream. Update MCP tool and README descriptions. Verify M1/M2/M3 route and MCP checks. Apply Code Simplifier to this slice.

## 4. Expose the Usable Fetch Catalog Entry

- [x] 4.1 Append Mdream to `FETCH_PROVIDERS` at zero cost and unknown monthly quota; use existing `configured` status for this keyless capability without credential lookup being a prerequisite. Allow nullable quota in the catalog schema, hide an unpublished quota in UI, and preserve other provider status paths. Verify M5 integration, card price and scrape selection. Apply Code Simplifier to this slice.

## 5. Review, Validate and Reconcile

- [x] 5.1 Run changed focused tests and `npm run typecheck:core`; inspect outcomes. Run any additional repository-required gates appropriate to the final diff. Record exact commands, observed results and remaining limits.
- [x] 5.2 Complete independent source-fidelity and simplicity/reuse reviews; correct material findings; update this change's `completion.review` for fixes. Run strict OpenSpec validation for `add-mdream-web-fetch-provider`. Do not represent CLI success as provenance or live validation.
- [x] 5.3 Reconcile all discovered next steps, deferred scope and live-evidence limits into root `openspec/TODO.md`; keep it in any eventual commit. State whether implementation/local tests alone satisfy the owner-approved acceptance, and retain any unresolved live gate. Use the archive workflow only once applicable acceptance is satisfied. Before any commit invoke Code Simplifier. No push without owner permission.
- [ ] 5.4 After owner-approved merge/deployment and controlled `/v1/web/fetch` acceptance, merge the delta into the living spec and archive this change. Do not archive before the route result is recorded.
