# Design: Reduce Production Webpack Cache Memory

## Decision

Use one unconditional production policy: whenever Next invokes OmniRoute's
custom webpack callback with a filesystem cache, set
maxMemoryGenerations to 0. Do not add an environment variable or Docker build
argument. The user approved the global production behavior on 2026-10-03.

## Evidence and Boundaries

- The pre-change staged Node 26 full build OOMed at the documented 12-GiB cgroup
  limit during webpack compilation. The victim was one Node process with
  anonymous RSS; the page-data phase had not started.
- The 6144-MiB V8 heap, one Next page-data worker, webpack bundler and
  webpackMemoryOptimizations setting are already in use. Worker-pool or
  prerender-concurrency changes do not target the observed phase.
- Next 16.3.5 builds a filesystem cache with production
  maxMemoryGenerations: Infinity and a disk directory under
  distDir/cache/webpack. Next sets this value to zero in development.
- Webpack documents that zero disables additional memory-cache generations.
  Cache entries may still remain in memory until serialized to disk. Therefore
  this change is a targeted retention reduction, not a hard memory bound.
- The user selected the attested official OmniRoute image plus a backend-only
  overlay. The official image supplies the complete UI; the fork's source-A
  backend-only compile exercises the production cache policy. No post-change
  full-UI build was run, so its memory effect and a 12-GiB full-build fit are
  unknown and are not release claims.

## Configuration Algorithm

For every invocation of the existing Next webpack hook:

1. If dev is true, leave the received configuration unchanged.
2. If config.cache is missing or its type is not filesystem, leave it
   unchanged.
3. Otherwise set only config.cache.maxMemoryGenerations to zero.
4. Continue applying the existing warning filters, split-chunk groups,
   minimal-build replacements, and return the same webpack configuration.

Equivalent pseudocode:

    webpack(config, { dev, webpack }) {
      if (!dev && config.cache?.type === \"filesystem\") {
        config.cache.maxMemoryGenerations = 0;
      }
      // Existing configuration continues unchanged.
      return config;
    }

Do not replace the cache object, change cache.type, cacheDirectory, version,
compression, buildDependencies, output settings, or included application
routes. This preserves Next's disk cache and the full dashboard/API standalone
artifact.

## Verification

- The known 12-GiB full-build OOM is historical RED evidence, not a post-change
  full-UI acceptance result.
- Invoke the actual imported next.config.mjs webpack callback with production
  filesystem, development filesystem, and production non-filesystem fixtures.
  Assert the production filesystem generation limit becomes zero, the disk
  directory and every other cache property remain unchanged, and the other two
  fixtures are untouched.
- Run JavaScript syntax validation.
- Build the backend-only output on the exact source with the production cache
  policy active, then verify the official-image overlay preserves the official
  UI and merges the fork's compiled API routes.
- Do not infer full-UI compiler memory savings or a 12-GiB fit from the
  backend-only compile. A full-UI memory benchmark is future work only if a
  later delivery requires rebuilding the dashboard.
