ARG OFFICIAL_IMAGE=ghcr.io/diegosouzapw/omniroute@sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c
ARG OFFICIAL_BASE_DIGEST=sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c

# Install lockfile-resolved dependencies once for both the backend compiler
# and the browser-capable runtime target.
FROM ${OFFICIAL_IMAGE} AS backend-dependencies
ARG OFFICIAL_IMAGE
ARG OFFICIAL_BASE_DIGEST
USER root
WORKDIR /app

RUN test "$OFFICIAL_IMAGE" = "ghcr.io/diegosouzapw/omniroute@$OFFICIAL_BASE_DIGEST"

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
ENV OMNIROUTE_USE_TURBOPACK=0
ENV OMNIROUTE_MITM_STUB=1
ENV NEXT_DIST_DIR=.build/next

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY open-sse/package.json ./open-sse/package.json
COPY scripts/build/postinstall.mjs ./scripts/build/postinstall.mjs
COPY scripts/build/postinstallSupport.mjs ./scripts/build/postinstallSupport.mjs
COPY scripts/build/native-binary-compat.mjs ./scripts/build/native-binary-compat.mjs

RUN test -f package-lock.json \
  && npm ci --include=optional --no-audit --no-fund --legacy-peer-deps --ignore-scripts \
  && (cd node_modules/better-sqlite3 \
      && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --force_build=1) \
  && node -e "require('better-sqlite3')(':memory:').close()"

# Build one fork UI and API tree with a shared Next build identity.
FROM backend-dependencies AS backend-builder
# AICODE-NOTE: The official image can contain source files absent from the fork.
# Remove them before COPY so stale routes and migrations cannot enter the build.
RUN find /app -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
COPY . ./
ARG OMNIROUTE_BUILD_SHA
ENV NODE_OPTIONS=--max-old-space-size=12288
ENV NODE_ENV=production
ENV OMNIROUTE_STRICT_STANDALONE=1
RUN mkdir -p /app/data \
  && OMNIROUTE_BUILD_SHA="$OMNIROUTE_BUILD_SHA" node scripts/build/write-build-sha.mjs --validate-only \
  && npm run build \
  && OMNIROUTE_BUILD_SHA="$OMNIROUTE_BUILD_SHA" node scripts/build/write-build-sha.mjs \
  && test -s /app/.build/next/standalone/server.js \
  && test -s /app/.build/next/standalone/.build/next/BUILD_ID \
  && test -s /app/.build/next/standalone/.build/next/server/app-paths-manifest.json \
  && test -d /app/.build/next/standalone/.build/next/static

# AICODE-NOTE: Separate operator bundle lets prebuilt backend packaging skip another Next build.
# AICODE-NOTE: Split queue-only normalization so direct operator doesn't resolve Bedrock SDK.
FROM backend-dependencies AS operator-builder
RUN find /app -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
COPY . ./
RUN node scripts/build/bundle-model-benchmark-search-reprocess.mjs

# Keep the official OS packages and runtime configuration; replace its entire
# application tree so no UI, server, dependency, or manifest crosses builds.
FROM ${OFFICIAL_IMAGE} AS runtime
USER root
RUN rm -rf /app/.build/next /app/node_modules /app/migrations /app/dev /app/public
COPY --from=backend-builder --chown=node:node /app/.build/next/standalone/ /app/
COPY --from=backend-builder --chown=node:node /app/node_modules/better-sqlite3/ /app/node_modules/better-sqlite3/
# AICODE-NOTE: The standalone tree may already carry migrations; replace it exactly.
RUN rm -rf /app/migrations
COPY --chown=node:node src/lib/db/migrations/ /app/migrations/
ENV OMNIROUTE_MIGRATIONS_DIR=/app/migrations
COPY --from=operator-builder \
  /app/dist/ops/ \
  /app/scripts/ops/
COPY tests/unit/build/model-benchmark-search-runtime-resolution.test.mjs \
  /app/scripts/ops/model-benchmark-search-runtime-resolution.test.mjs
USER root
# AICODE-NOTE: Keep resolver test under /app so bare imports resolve against runtime node_modules.
# AICODE-NOTE: Resolve only the direct operator's eager module graph; importing it would run DB initialization.
RUN --network=none BENCHMARK_OPERATOR_ROOT=/app \
  BENCHMARK_OPERATOR_METAFILE=/app/scripts/ops/reprocess-model-benchmark-search.meta.json \
  node --test /app/scripts/ops/model-benchmark-search-runtime-resolution.test.mjs \
  && rm /app/scripts/ops/model-benchmark-search-runtime-resolution.test.mjs \
    /app/scripts/ops/reprocess-model-benchmark-search.meta.json
# AICODE-NOTE: Check-mode imports operator modules only.
# Its forced temporary DATA_DIR isolates import-time DB initialization.
RUN --network=none rm -rf /tmp/model-benchmark-search-runtime-check \
  && node /app/scripts/ops/reprocess-model-benchmark-search.mjs --check-runtime \
  && rm -rf /tmp/model-benchmark-search-runtime-check
USER node

# AICODE-NOTE: Keep browser packages sourced from shared dependencies so
# prebuilt backend packaging never pulls in backend-builder compilation.
FROM runtime AS runtime-web
USER root
COPY --from=backend-dependencies /app/node_modules/playwright /app/node_modules/playwright
COPY --from=backend-dependencies /app/node_modules/playwright-core /app/node_modules/playwright-core

ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright

RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb xauth \
  && node node_modules/playwright/cli.js install chromium --with-deps \
  && chown -R node:node /home/node/.cache \
  && rm -rf /var/lib/apt/lists/*

USER node
ENTRYPOINT ["/usr/bin/xvfb-run", "-a", "-s", "-screen 0 1920x1080x24 -nolisten tcp", "/app/check-permissions.sh"]
# AICODE-NOTE: Setting ENTRYPOINT clears the base CMD; restore the application launcher explicitly.
CMD ["node", "dev/run-standalone.mjs"]
