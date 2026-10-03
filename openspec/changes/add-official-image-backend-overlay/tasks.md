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
      focused tests, ESLint, and Node syntax checks pass; Docker BuildKit syntax
      validation remains pending because the local Docker daemon socket is
      unavailable.
- [ ] 3.2 Run `npm run build:backend` with `NEXT_DIST_DIR=.build/backend-overlay`
      on the exact fork source. Confirm every official API route has a compiled
      counterpart and that the backend server/chunk tree is present.
- [ ] 3.3 Build the ARM64 overlay image from the pinned official digest without
      compiling dashboard pages. Confirm final base digest, Node 26.10.0, and
      Next.js 16.3.5.
- [ ] 3.4 Run an isolated local container smoke: official dashboard route and
      static assets load, `/v1/systemone` reaches the fork handler through the
      existing rewrite, and a normal `/v1` API route still dispatches.
- [x] 3.5 Record pending target-host Dockerfile/BuildKit validation, ARM64 image
      build and stock-UI parity, SystemOne/band route smoke, isolated database
      migration rehearsal, publication, cutover, Radar/live checks, and Next digest
      revalidation in repo-level `openspec/TODO.md`. Do not publish or deploy in
      this package.
