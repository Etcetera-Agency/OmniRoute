# Change: Register overlay API URLs in the production Next router

Approved by the user on 2026-10-04: fix production first, test, transfer to main, deploy.

## Why

The pinned production image contains `/api/v1/systemone/route` in its server
app-path manifest, but omits it from the root app-path-routes map. Next 16.3.5
registers request URL paths from that separate map. Direct bundle invocation
works, while authenticated HTTP `/v1/systemone` reaches catch-all and returns
404. Enabling the Laya env variables does not repair route discovery.

## What Changes

- Merge overlay API URL mappings into the official app-path-routes manifest;
  validate mappings and retain official dashboard mappings.
- Merge overlay API static/dynamic route descriptors from the compiled route
  manifest while preserving official UI routes and rewrite deduplication.
- Copy the merged root mapping into the final Docker image.
- Add regression coverage using Next's real filesystem route discovery;
  direct bundle loading alone cannot verify URL registration.
- Supersede the archived design's inaccurate manifest assumption in this
  change; retain archived history unchanged.
- Record Laya-only production configuration and actual HTTP acceptance.

## Impact

Capability: official-image-backend-overlay. Files: merger, overlay Dockerfile,
focused merge tests, deployment documentation, review and TODO records.
No API shape changes, compatibility adapter, provider credentials, fallback
credentials, browser action execution, or dashboard provider card changes.
The server hotfix modifies only two routing manifests inside the existing
container; recreation discards it. The accepted source image must replace it.
