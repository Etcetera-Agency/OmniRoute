# Implementation Tasks

## 1. Red Baseline

- [x] 1.1 Record retry 5 as the RED build-acceptance result: exact staged
      db18a17c374506941d10fbc58132eb108d1ea5db, full runner-base target, Node 26,
      webpack, 6144-MiB heap, two configured workers (one Next page-data worker),
      12-GiB memory-plus-swap limit; cgroup OOM killed the Next worker before an
      image was produced. Evidence remains in openspec/TODO.md and
      openspec/changes/add-auto-band-seam/tasks.md.

## 2. Implementation

- [x] 2.1 In next.config.mjs, before the existing webpack callback changes,
      set maxMemoryGenerations to zero only when dev is false and the received
      cache type is filesystem. Add an AICODE-NOTE explaining that production
      filesystem-cache generations otherwise retain extra memory and that disk
      caching/full app output must remain intact.
- [x] 2.2 Run an inline smoke against the actual imported webpack callback:
      production filesystem cache becomes zero while cache type, cache directory,
      cache version, compression, build dependencies and unrelated webpack fields
      remain unchanged; development filesystem and production non-filesystem cache
      inputs remain unchanged.
- [x] 2.3 Run node --check next.config.mjs.
- [x] 2.4 Run Code Simplifier on the changed callback; its guarded assignment is
      already the smallest clear implementation, so no further code change was
      needed.

## 3. Build Acceptance

- [ ] 3.1 Build the full production target on the exact staged source with the
      documented 12-GiB profile. Confirm optimized compilation completes, the
      standalone image is produced, and the existing dashboard/API route set is
      retained. A repeated OOM keeps the build gate red.
- [ ] 3.2 Reconcile TODO.md and completion.review through the metadata owner
      after the full build result is known; do not mark this package complete on
      the config smoke alone.
