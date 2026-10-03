# Design: Backend Overlay on the Official OmniRoute Image

## Decision

Use one multi-stage Dockerfile. Build the fork's backend-only Next output from
the fork source, or adapt a separately compiled backend export, then use the
verified official OmniRoute image as the final stage. Run manifest merging in
an intermediate stage and copy only the backend subtree and three merged
manifests into a fresh official stage. This leaves the official runtime user,
environment, entrypoint, and command inherited unchanged. Keep the overlay's
complete compiled server tree at
`/app/.build/next/omni-overlay/server`, a sibling of the official
`.build/next/server` tree inside the same dist directory. Do not transplant its
chunks into the official server tree.

The digest is:

```text
ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96
```

Public SLSA provenance ties this ARM64 image to upstream commit
`23a11484862b3bb589a55e85b00e4ac53ffeb234`. The inspected image runs Node
26.10.0 and Next.js 16.3.5, and its production dist directory is
`/app/.build/next`.

## Runtime Resolution Evidence

Next.js 16.3.5 `getMaybePagePath()` reads
`<distDir>/server/app-paths-manifest.json`. When a manifest value is absolute,
the resolver returns it unchanged. `requirePage()` then requires that exact
path. Therefore an API route can point at an absolute overlay bundle while
relative `require()` calls inside that bundle resolve against the overlay's
own sibling `server/chunks` directory.

The inspected official image has 883 App Router entries in
`server/app-paths-manifest.json`, including 103 `/api/v1*` routes. It has no
`app-path-routes-manifest.json`; this design uses the actual 16.3.5 runtime
manifest contract. The official `routes-manifest.json` already contains the
`/v1/:path*` to `/api/v1/:path*` rewrite. The SystemOne route is reachable
through that rule once its API route entry is merged.

## Manifest Merge

Keep all official UI entries and fields. Replace or add API route entries from
the backend build with absolute paths into the isolated server subtree. Require
every API route key present in the official image to exist in the backend
build, and verify that every resulting file is inside the overlay tree and
exists before writing manifests.

Merge only API keys in `server/functions-config-manifest.json`; this keeps
official UI function settings and supports API settings such as
`maxDuration`. Merge the `beforeFiles`, `afterFiles`, and `fallback` rewrite
arrays by appending structurally new entries only. Leave other routing
manifest fields and UI manifests intact. The existing `/v1` rewrite is retained
once, with no duplicate.

Do not replace the official build ID, `server/pages-manifest.json`,
`server/server-reference-manifest.json`, middleware manifest, static files, or
client bundles. The backend-only build's stub dashboard output is never routed
to by the merged app-path manifest.

## Build and Merge Algorithm

```text
buildDist = ".build/backend-overlay"
overlayServer = buildDist + "/server"
runtimeOverlayServer = "/app/.build/next/omni-overlay/server"
baseDist = "/app/.build/next"

1. Run the existing backend-only Next build with NEXT_DIST_DIR=buildDist.
2. Copy overlayServer recursively to runtimeOverlayServer, preserving paths.
3. Read baseDist/server/app-paths-manifest.json and
   buildDist/server/app-paths-manifest.json.
4. Require every base API route key in the backend manifest.
5. For each backend key beginning with /api/:
     bundle = normalized backend manifest value
     require bundle to be a relative path under app/api/
     require buildDist/server/bundle to exist
     baseManifest[key] = absolute(runtimeOverlayServer/bundle)
6. Merge backend API function-config entries into the base functions map.
7. Merge backend rewrite groups into base rewrite groups, keeping one copy of
   structurally identical rules.
8. Write the merged app-path, functions-config, and routes manifests in an
   intermediate image stage.
9. Start the final stage again from the pinned official image and copy only the
   isolated server subtree and the three merged routing manifests.
10. Fail before image creation on missing routes, malformed manifests, escaped
   paths, or missing bundles.
```

Equivalent pseudocode for route dispatch:

```js
for (const [routeKey, bundlePath] of Object.entries(backendAppPaths)) {
  if (!isApiRoute(routeKey)) continue;
  const sourceBundle = resolveInside(backendServer, bundlePath);
  assertExists(sourceBundle);
  baseAppPaths[routeKey] = resolve(runtimeOverlayServer, bundlePath);
}

writeJson(baseServerAppPaths, baseAppPaths);
```

## Verification

- A focused Node test proves Next.js 16.3.5 resolves an absolute API route path
  from the base manifest and requires a relative chunk from the overlay tree.
- Manifest tests prove all base API paths survive, fork API paths are added,
  API function settings merge, `/v1/:path*` appears once, and UI manifests,
  page bundles, static assets, and build ID remain byte-for-byte unchanged.
- Root and nested `.envrc` files are excluded from Docker build contexts, so the
  compiler stage cannot copy them into an intermediate image layer.
- The backend-only Next build and a local container smoke must serve both a
  dashboard page from the official UI and `/api/v1/systemone` from the overlay.
- Image publication and production replacement remain separate operations and
  require their existing operator workflow.
