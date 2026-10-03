# Change: Reduce Production Webpack Cache Memory

**Status:** Approved for implementation by the user on 2026-10-03.

## Why

The pre-change full production build for the reviewed Node 26 source reached
the cgroup limit during webpack compilation. Retry 5 used the documented
12-GiB runner-base profile, the 6144-MiB V8 heap, one Next page-data worker,
and webpack; the cgroup OOM-killed the Next worker before an image was
produced. Reducing the V8 heap to 4096 MiB had already failed with a V8 heap
fatal error, and the current worker and webpack memory-optimization settings
are already at their supported minimum or enabled.

Next 16.3.5 constructs a production filesystem cache with
maxMemoryGenerations set to Infinity. Webpack documents that zero disables
additional memory-cache generations, while entries can remain resident until
serialized to disk. This is the smallest available cache-retention change
supported by the observed build evidence; it may reduce retained memory, but
it does not guarantee the compiler's live peak will fit.

The user selected the attested official OmniRoute image plus a backend-only
overlay as the delivery path. The verified official image already contains the
complete UI, so this delivery does not rebuild the dashboard. The cache policy
is exercised by the fork's backend-only compile; its effect on a full-UI build
and a 12-GiB full-build fit remain unmeasured.

## What Changes

- Set maxMemoryGenerations to 0 for every production webpack compiler whose
  existing cache type is filesystem.
- Keep the filesystem cache, its directory and all other cache settings. Keep
  development builds and non-filesystem cache configurations unchanged.
- Do not add a build flag, change route selection, or disable the normal full
  application build path. The selected release image keeps the official full
  standalone UI and adds the fork's backend-only output.

## Impact

### Affected Specifications

- New capability: production-webpack-build-memory.

### Affected Code

- next.config.mjs: set the cache-generation limit at the start of the existing
  webpack callback, before its warning and chunk configuration changes.

### User Impact

There is no intended runtime behavior change. The policy prevents additional
filesystem-cache generations from being retained by each production compiler.
It may reduce retained memory and may take longer because it relies more on
filesystem-cache reads and serialization. The full-UI memory effect is
unmeasured; this change does not promise a 12-GiB full-build fit.

### API Changes

None.

### Migration Required

- [ ] Database migration
- [ ] API version bump
- [ ] User communication needed
- [ ] Documentation updates

## Risks

- A zero generation limit does not evict an entry before Webpack serializes it
  to disk, so it may not reduce the measured main-process peak enough to pass.
- A global production setting may increase build time on high-memory builders.
- The accepted delivery uses the pinned official UI image plus the exact-source
  backend-only overlay. The full-UI cache-memory effect remains unmeasured and
  is future work only if a later delivery needs to rebuild the dashboard.
