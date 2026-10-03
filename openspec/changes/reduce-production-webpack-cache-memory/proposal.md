# Change: Reduce Production Webpack Cache Memory

**Status:** Approved for implementation by the user on 2026-10-03.

## Why

The full production build for the reviewed Node 26 source still reaches the
cgroup limit during webpack compilation. Retry 5 used the documented
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

## What Changes

- Set maxMemoryGenerations to 0 for every production webpack compiler whose
  existing cache type is filesystem.
- Keep the filesystem cache, its directory and all other cache settings. Keep
  development builds and non-filesystem cache configurations unchanged.
- Keep the normal full application build and standalone output. Do not add a
  build flag or change route selection.

## Impact

### Affected Specifications

- New capability: production-webpack-build-memory.

### Affected Code

- next.config.mjs: set the cache-generation limit at the start of the existing
  webpack callback, before its warning and chunk configuration changes.

### User Impact

There is no intended runtime behavior change. Production builds may use less
retained cache memory and may take longer because they rely more on filesystem
cache reads and serialization.

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
- Completion requires a successful full production image build on the exact
  reviewed source; the focused config check is not build acceptance.
