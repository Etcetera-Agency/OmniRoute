# Design: Source-built startup entry in the official-image overlay

## Decision

Use the selected backend build's compiled `server/instrumentation.js` as the
application startup implementation. Keep the compiled entry and all relative
chunks under the existing `/app/.build/next/omni-overlay/server` subtree. Point
the official Next.js root entry at that artifact with a minimal, readable
CommonJS delegate.

This reuses the source build of `src/instrumentation.ts` and its existing
`registerNodejs` call. The official UI, static output, base build ID, route
registration, and isolated API route bundles continue through the current merge
path.

## Assembly Order

1. Read and validate official and selected-backend manifests as today.
2. Resolve the source-built instrumentation file and require it to be a regular
   file within the selected overlay server tree.
3. Copy the selected backend server tree to the configured runtime overlay
   subtree when the two paths differ.
4. Resolve the runtime instrumentation file and require it to remain inside
   that runtime subtree.
5. Compute a relative CommonJS request from the official `server` directory to
   the runtime overlay entry. Write a temporary root `instrumentation.js` that
   only exports that required module, then rename it into place.
6. Write the already validated merged manifests.
7. In the final runtime stage, explicitly COPY the generated root instrumentation
   entry from merged-backend alongside the overlay tree and four manifests. A
   fresh official final-stage fixture must execute that copied delegate.

If either instrumentation entry is absent, assembly fails before replacing the
route manifests. No fallback to the official BASE entry is permitted: silently
falling back would recreate the known startup defect while producing an image
that looks complete.

## Runtime Behavior

Next.js loads the root instrumentation module once for a Node server instance.
The delegate returns the source-built module's exports unchanged, so `register`
and any future instrumentation exports retain their native behavior. Because
the target module stays inside the overlay tree, its relative Webpack imports
resolve there instead of colliding with official server chunks.

The source-built startup already registers models.dev through
`initModelsDevSync()`. With the saved setting enabled and no disabling env flag,
that helper installs one periodic timer and launches its initial sync without
waiting. A successful capability sync transactionally updates models.dev
pricing plus the raw zero-price snapshot, then starts the benchmark catalog
metadata refresh asynchronously. This metadata refresh is the only AA access in
this chain; it does not claim or drain benchmark search work.

## Regression Proof

- Fixture source entry requires a fixture chunk and native-startup marker.
  After assembly, requiring the official root entry and invoking `register`
  must reach that marker from the runtime overlay path; the official base marker
  must remain unused.
- A missing selected entry must fail assembly and leave official manifests
  untouched.
- The existing native models.dev helper runs against an isolated test DB,
  fixture-only fetch, and captured timer functions. The saved enabled setting
  must produce exactly one timer, one immediate models.dev fetch, one zero-price
  snapshot write, and a completed fixture-only benchmark metadata refresh.
- The saved paused setting must produce no timer or fetch when the env override
  is unset. Search queue attempts remain zero, no row is claimed, and unlisted
  URLs fail the fetch mock.

No test invokes `registerNodejs()` as a production startup, the credential
health probe, provider validation, benchmark normalization, or inference.

## Deferred Acceptance

This local package cannot establish that a final OCI image contains the
source-built entry. Parent acceptance of the local result precedes the already-
authorized GitHub artifact and deployment phases; no additional owner permission
gate is introduced. No local or server-image build is part of this slice. Before
any production startup/restart, confirm
`OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK=true`; the guard disables the global
background health sweep only, while explicit provider-test routes remain
available. Keep this exact limitation and the immutable artifact gate in the
repo-level TODO until the already-authorized artifact/runtime phases complete.
Parent authorized the persistent disable-env delta after local review during
that deployment; this local correction does not change configuration.
