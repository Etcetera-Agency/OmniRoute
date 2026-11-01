# Change: Load source-built instrumentation at startup

> Current closure: parent accepted final runtime on 2026-11-01 and authorized
> archiving. Earlier runtime-pending and health-choice statements below are
> historical; selected functional contracts remain unchanged.

## Why

The official-image overlay currently installs the fork's API bundles under an
isolated server subtree, while Next.js still loads the official image's root
`server/instrumentation.js`. The live artifact confirmed that this leaves the
fork's source-built `instrumentation.ts` and its `registerNodejs` startup path
unused. The required zero-price snapshot writer therefore does not run on the
periodic models.dev path.

The owner selected the full source-built OVERLAY startup. Package the selected
overlay's compiled instrumentation through Next.js's existing root startup
entry, keeping its compiled dependencies inside the overlay subtree. Do not
patch or minify the official startup bundle.

## What Changes

- Validate that the selected backend artifact contains its compiled
  `server/instrumentation.js` before changing official output.
- Keep the source-built instrumentation and its relative chunks under the
  existing isolated runtime subtree, then make the official server's root
  instrumentation entry delegate to that compiled entry.
- Fail the merge if the source-built startup entry is missing or cannot be
  resolved within the isolated subtree.
- Add an offline artifact fixture that loads the merged entry and follows a
  relative dependency to a native `registerNodejs` marker. Preserve official
  UI manifests, assets, and build ID.
- Exercise the existing models.dev native helper with saved sync enabled and
  paused settings, fake timers, an isolated fixture DB, and a closed fetch mock.
  Prove one periodic registration, immediate sync, one raw zero-price snapshot
  write, and the asynchronous benchmark-catalog refresh. Confirm no benchmark
  search claim, normalizer, or inference call runs.

## Selected Design

The merger writes one small CommonJS dispatch file at the root path Next.js
loads. Its only action is to require
`../omni-overlay/server/instrumentation.js`. Node then resolves the compiled
startup entry's own relative chunks from the same isolated overlay tree. The
compiled entry remains the fork build of `src/instrumentation.ts`, which
continues to invoke the existing `registerNodejs` implementation.

```text
Next.js root server/instrumentation.js
  -> require ../omni-overlay/server/instrumentation.js
       -> source-built instrumentation chunk graph
            -> existing registerNodejs()
```

Pseudocode:

```text
source_entry = overlay_server / "instrumentation.js"
require source_entry is a regular file inside overlay_server

copy overlay_server to runtime_overlay_server if not already there
runtime_entry = runtime_overlay_server / "instrumentation.js"
require runtime_entry resolves inside runtime_overlay_server

request = relative path from official_server to runtime_entry
write temp official_server / "instrumentation.js":
    module.exports = require(request)
rename temp file to official_server / "instrumentation.js"

write merged route manifests
final runtime FROM official:
    COPY generated root delegate from merged-backend
    COPY existing isolated overlay tree and four merged manifests
```

The existing Dockerfile already selects and copies the backend server tree into
the isolated runtime subtree before invoking the merger. The final runtime
stage starts from official again, so it must also explicitly copy the generated
root instrumentation delegate from merged-backend. No extra timer,
startup scheduler, model writer, feature flag, UI bundle, route policy, or
provider behavior is introduced.

## Impact

- Affected capability: `official-image-backend-overlay`.
- Production packaging: `scripts/build/merge-official-backend-overlay.mjs` and
  `docker/official-backend-overlay.Dockerfile`.
- Offline regressions: `tests/unit/build/merge-official-backend-overlay.test.mjs`
  and `tests/unit/modelsDevSyncBenchmarkHook.test.ts`.
- Runtime remains on the previously published BASE artifact until the parent
  accepts this local result and the already-authorized GitHub artifact and
  deployment phases complete. No new owner permission gate is added. The old
  BASE periodic-writer defect remains live until that deployment.
- Full source startup retains the existing credential-health scheduler. Before
  any later production startup/restart, the parent must confirm the existing
  `OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK=true` setting is effective. That
  setting disables only the background credential-health sweep; it does not
  disable manual provider-test routes.
- No local application or server-image build, publish, push, deployment, provider
  probe, benchmark search, normalization, or inference is part of this change.
