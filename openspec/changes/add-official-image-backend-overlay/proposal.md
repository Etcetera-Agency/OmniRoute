# Change: Add a Backend Overlay for the Official OmniRoute Image

**Status:** Approved for implementation by the user on 2026-10-03.

## Why

The fork's full Next.js production build has repeatedly been killed by the
builder memory limit. The official ARM64 OmniRoute image for upstream revision
`23a11484862b3bb589a55e85b00e4ac53ffeb234` is available by digest and already
contains the complete dashboard. The fork adds backend behavior used by chat,
model catalog, and SystemOne API routes. Rebuilding every dashboard page to
ship those server changes repeats the memory-heavy work unnecessarily.

## What Changes

- Add a dedicated overlay Dockerfile pinned to the verified official image
  digest `ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96`.
- Compile the fork with the existing backend-only Next.js build mode, placing
  output under a separate dist directory. Keep the official image as the final
  runtime base.
- Copy the compiled backend server tree to its own dist subtree beside the
  official server tree. Merge every API route entry into the official
  `server/app-paths-manifest.json` as an absolute path to that overlay's route
  bundle. This covers all API consumers of the changed auto-combo code and the
  new SystemOne route.
- Merge backend API function configuration and deduplicated route rewrite
  entries into the official manifests. Preserve the official dashboard,
  static assets, build ID, page bundles, and UI manifests.
- Fail the image build if a stock API route has no overlay bundle, an overlay
  bundle path escapes its server tree, or required manifest shapes differ.

## Impact

### Affected Specifications

- New capability: `official-image-backend-overlay`.

### Affected Code

- `docker/official-backend-overlay.Dockerfile`: backend-only compiler stage and
  official digest-pinned runtime stage.
- `.dockerignore`: excludes root and nested `.envrc` files from every Docker
  build context, including the backend compiler context.
- `scripts/build/merge-official-backend-overlay.mjs`: isolated server copy and
  manifest merge.
- `tests/unit/build/merge-official-backend-overlay.test.mjs`: resolver,
  manifest, route-rewrite, and UI-preservation coverage.

### User Impact

The resulting image serves the official dashboard from its original compiled
assets while dispatching API handlers from the fork's backend-only build. The
backend compilation still runs Next.js over API routes; it skips the dashboard
page and client-component graph. The final stage inherits the official image's
runtime user, environment, entrypoint, and command unchanged.

### API Changes

No API wire shape changes are introduced by the packaging layer. Existing
`/v1/:path*` rewriting continues to route to `/api/v1/:path*`; the overlay adds
the fork's `/api/v1/systemone` handler to Next's route table.

### Migration Required

- [ ] Database migration
- [ ] API version bump
- [ ] User communication needed
- [x] Docker build and runtime smoke required before image publication

## Risks

- Next route bundles use relative server chunk paths. Copying the complete
  backend server tree under the same internal layout keeps those imports inside
  the isolated subtree; the manifest test exercises this resolver boundary.
- The overlay and runtime must use Next.js 16.3.5. Both build and final stages
  are pinned to the verified upstream image so route bundles share the exact
  Next.js runtime.
- The official image digest is ARM64. This Dockerfile produces the matching
  ARM64 overlay image and must not claim support for other architectures.
