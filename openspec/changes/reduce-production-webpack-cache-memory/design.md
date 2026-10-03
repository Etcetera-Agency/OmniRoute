# Design: Reduce Production Webpack Cache Memory

## Decision

Use one unconditional production policy: whenever Next invokes OmniRoute's
custom webpack callback with a filesystem cache, set
maxMemoryGenerations to 0. Do not add an environment variable or Docker build
argument. The user approved the global production behavior on 2026-10-03.

## Evidence and Boundaries

- The exact staged Node 26 full build OOMed at the documented 12-GiB cgroup
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

- The known 12-GiB full-build OOM is the RED baseline.
- Invoke the actual imported next.config.mjs webpack callback with production
  filesystem, development filesystem, and production non-filesystem fixtures.
  Assert the production filesystem generation limit becomes zero, the disk
  directory and every other cache property remain unchanged, and the other two
  fixtures are untouched.
- Run JavaScript syntax validation.
- The GREEN acceptance is a full production image build on the exact source.
  A config-fixture pass alone does not close this change.
