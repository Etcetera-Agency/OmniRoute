# Design: Complete overlay route registration

## Selected implementation

Retain isolated API bundles and official UI artifacts. URL discovery and
module resolution must agree: the root app-path-routes manifest maps internal
App Router keys to URL paths, and server/app-paths maps the same keys to
absolute overlay bundles. Merge compiled API entries in both structures.

Only overlay API entries may replace official entries. Reject missing,
malformed, or inconsistent API mappings before writing output. Official UI
keys remain intact. Static and dynamic route descriptors come from compiler
output; merge by route page, preserving official UI descriptors. Never
invent SystemOne-specific regexes in the durable merger. Copy root mapping
alongside existing server and routes manifests into the final image.

## Pseudocode

```text
read official and overlay app-paths, app-path-routes, routes manifests
validate object maps and every overlay API route's URL mapping
for each overlay API route key:
    verify compiled bundle exists inside isolated overlay tree
    merged app-paths[key] = absolute overlay bundle
    merged app-path-routes[key] = overlay URL path
for staticRoutes and dynamicRoutes:
    keep official descriptors except API pages supplied by overlay
    add validated overlay API descriptors, deduplicate by page
preserve official UI entries and structurally deduplicate rewrite groups
write merged manifests only after validation succeeds
copy isolated backend + all merged registration manifests into final image
```

## Acceptance and rollback

Failing regression must show Next setupFsCheck cannot discover a new overlay
API URL before the fix. Passing regression must return appFile after merging,
retain official UI mapping, and keep direct module/chunk resolution intact.

Production baseline: authenticated SystemOne 404. Authorized temporary server
patch added SystemOne root map and static route, then restarted OmniRoute.
English/RU/UK choice calls returned 200/technical; frozen browser request returned
200/choice2 with native1024/768 context and no truncation. This proves route
and profile connectivity, not general browser decision accuracy. Unauthed
private call remains401, public call403, Redis DNS/TCP pass, container healthy. Call logs show all three model selectors
with200 and no stored request/response bodies.

Protected env backup: `/opt/apps/omniroute/.env.before-laya-20261004T085725Z`.
Manifest backups: `/opt/apps/omniroute-deploy-diagnostics/laya-systemone-20261004/`.
To undo temporary routing patch, copy `.before` manifests back and restart.
To disable integration, restore protected env backup and recreate through the
four CD compose files with project-directory `/opt/apps/omniroute`. Do not
expose public v1 routes or change unrelated services. Final accepted image
must be pinned by source/digest and pass the same HTTP tests after recreation.

## Correction to historical design

The archived `2026-10-03-add-official-image-backend-overlay/design.md` asserted
that app-path-routes was absent and unnecessary. Production evidence and
Next16.3.5 filesystem routing show that assumption is false. The archive
remains historical evidence; this change and its merged living requirements
supersede that claim. Direct requirePage tests validated module loading only.

## Runtime helper packaging correction

A live probe of the pinned official-derived image on2026-10-04 showed
`sortable-routes.js` absent from standalone runtime, despite its presence in
local full Next dependencies. Runtime `sorted-routes.js` exports the route
ordering helpers and is retained. The merger must use the retained runtime
helper and test loading against the runtime dependency subset. Workflow
37192253790 for source0e12d43fde was cancelled before publication; the server's
working temporary patch remained intact. No fallback dependency resolver or
vendored Next compatibility code is introduced.
