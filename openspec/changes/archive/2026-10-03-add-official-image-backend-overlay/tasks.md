# Implementation Tasks

## 1. RED baseline

- [x] 1.1 Add focused tests for API-only app-path merge, required stock route
      coverage, API function-config merge, rewrite deduplication, and UI artifact
      preservation.
- [x] 1.2 Use Next.js 16.3.5's real `requirePage()` in the test fixture to prove
      absolute manifest paths load from the overlay server tree and relative chunk
      imports resolve beside the overlay route bundle.
- [x] 1.3 Run the test before implementation and record the expected missing
      helper failure.

## 2. Implementation

- [x] 2.1 Add `scripts/build/merge-official-backend-overlay.mjs`. Copy the whole
      backend server tree into a separate runtime subtree; validate route paths,
      source files, and required stock API keys before manifest writes.
- [x] 2.2 Merge only API entries into `server/app-paths-manifest.json` and
      `server/functions-config-manifest.json`; merge rewrite groups with stable
      structural deduplication. Preserve all official UI manifest entries.
- [x] 2.3 Add `docker/official-backend-overlay.Dockerfile`, pinning both compiler
      and final stages to the verified ARM64 official image digest. Run the
      existing backend-only build with a separate `NEXT_DIST_DIR`; allow a named
      prebuilt backend-export context so packaging can skip a duplicate compile;
      copy only compiled server output and the merge helper to the final image.
- [x] 2.4 Add an `AICODE-NOTE:` at the absolute route-path boundary explaining
      why route chunks and their relative imports must stay in a separate server
      subtree.
- [x] 2.5 Run Code Simplifier on the implementation slice and retain the
      smallest clear manifest merge.

## 3. Verification

- [x] 3.1 Run the focused helper test and relevant lint/syntax checks. The
      focused tests, ESLint, and Node syntax checks pass. The target BuildKit
      parsed and built the candidate image; the local Docker daemon remains
      unavailable.
- [x] 3.2 Run the backend-only Next build on source
      `4b29aa12fcc51fb183b196b67f878fb8ca67b5b2` with
      `NEXT_DIST_DIR=.build/backend-overlay`. The verified export contains the
      app-path manifest, functions-config, rewrites, and server chunks,
      including SystemOne and Radar handlers. The image merger validated the
      stock API route set and merged the overlay API entries.
- [x] 3.3 Build the ARM64 overlay image from official base digest
      `sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`
      without compiling dashboard pages. Candidate pack source is
      `55f40468137290e8efdc24a1a1b95b111a61d91a`; inspection confirmed Node
      26.10.0, Next.js 16.3.5, and native SQLite query success. Official and
      candidate build IDs/static assets match, and all 159 non-API app-path
      entries are unchanged.
- [x] 3.4 Run the isolated container smoke. The candidate healthcheck passed;
      `/dashboard/radar` returned 200; `/v1/systemone` reached the fork handler
      and returned its route-specific `unknown_route` 404 with the feature flag
      disabled; and `/v1/models` returned the expected `401 AUTH_002`, confirming
      ordinary API dispatch reached authentication. The fresh isolated database
      copy passed integrity, foreign-key, ledger, trigger, and second-startup
      checks; see [TODO](../../TODO.md) for the separate rollout record.
- [x] 3.5 Record remaining release gates in repo-level `openspec/TODO.md`.
      The candidate image, stock-UI parity, and isolated database-copy migration
      rehearsal are recorded as passed; candidate digest publication,
      authenticated/enabled route checks, production cutover, Radar/live checks,
      and Next digest revalidation remain pending. Do not publish or deploy in
      this package.
