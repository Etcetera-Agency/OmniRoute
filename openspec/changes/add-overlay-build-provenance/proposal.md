# Change: Bind overlay build identity to the source revision

## Why

The published image inherits its runtime from an official Node 26 / Next.js
16.3.5 image. That base image's `BUILD_SHA` identifies the upstream base, while
the fork's backend overlay is compiled from a separate source revision. OCI
labels identify the requested source revision, but the image verifier does
not currently prove that the compiled overlay carries that same identity.
This leaves source selection, the backend compiler, and the final image
unbound at the artifact boundary.

## What Changes

- Pass the workflow's full `github.sha` into the Docker build as
  `OMNIROUTE_BUILD_SHA`.
- Validate that value as a lowercase, full 40-character commit SHA after the
  source tree is copied into `backend-builder`, before backend compilation and
  before any identity stamp is written.
- Reuse `scripts/build/write-build-sha.mjs` to stamp the compiled backend
  output, and place that exact stamp at
  `.build/backend-overlay/server/BUILD_SHA`.
- Require the selected server tree in `merged-backend` to contain a valid
  `server/BUILD_SHA` equal to the build argument. This applies to both the
  regular builder and the existing `prebuilt-backend` adapter. An unstamped
  or mismatched prebuilt export fails closed; no compatibility fallback or
  fabricated stamp is added.
- Before the candidate starts, run a bounded, network-isolated, read-only
  one-shot container to read the final overlay stamp. Require that value to
  equal the expected full source SHA and OCI revision label.
- Record the exact artifact tuple only after a real ARM64 build. Source-code
  tests and host-platform identity do not establish a Linux ARM64 image tuple.

## Impact

Changes are limited to the existing image writer, official overlay Dockerfile,
image workflow, image verifier, focused tests, and this OpenSpec/TODO evidence.
The official UI/base `BUILD_SHA`, API routes, authentication, server deployment,
and runtime behavior are unchanged. No server build, publication, push, merge,
or deployment is part of this change.
