ARG OFFICIAL_IMAGE=ghcr.io/diegosouzapw/omniroute@sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c
ARG OFFICIAL_BASE_DIGEST=sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c
ARG BACKEND_ARTIFACT_STAGE=backend-builder

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
ENV NEXT_DIST_DIR=.build/backend-overlay

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

# Build the fork's API bundles against the exact Next.js and Node versions in
# the verified official image. NEXT_DIST_DIR isolates this output from its UI.
FROM backend-dependencies AS backend-builder
COPY . ./
ARG OMNIROUTE_BUILD_SHA
RUN OMNIROUTE_BUILD_SHA="$OMNIROUTE_BUILD_SHA" NEXT_DIST_DIR=.build/backend-overlay node scripts/build/write-build-sha.mjs --validate-only

# AICODE-NOTE: build-next-isolated preserves inherited NODE_OPTIONS.
# Keep the 12-GiB override in backend-builder only.
ENV NODE_OPTIONS=--max-old-space-size=12288
# AICODE-NOTE: Install dev dependencies first; run Next prerender in production mode.
ENV NODE_ENV=production

RUN mkdir -p /app/data \
  && npm run build:backend \
  && OMNIROUTE_BUILD_SHA="$OMNIROUTE_BUILD_SHA" NEXT_DIST_DIR=.build/backend-overlay node scripts/build/write-build-sha.mjs \
  && cp /app/.build/backend-overlay/standalone/BUILD_SHA /app/.build/backend-overlay/server/BUILD_SHA \
  && test -s /app/.build/backend-overlay/server/app-paths-manifest.json \
  && test -s /app/.build/backend-overlay/app-path-routes-manifest.json \
  && test -s /app/.build/backend-overlay/server/functions-config-manifest.json \
  && test -s /app/.build/backend-overlay/routes-manifest.json

# AICODE-NOTE: Separate operator bundle lets prebuilt backend packaging skip another Next build.
# AICODE-NOTE: Split queue-only normalization so direct operator doesn't resolve Bedrock SDK.
FROM backend-dependencies AS operator-builder
COPY . ./
RUN node scripts/build/bundle-model-benchmark-search-reprocess.mjs

# Adapter for a separately compiled backend export. This stage is selected
# only when BACKEND_ARTIFACT_STAGE=prebuilt-backend; BuildKit prunes the
# backend-builder stage, so packaging does not compile a second time.
FROM scratch AS prebuilt-backend
COPY --from=backend_export /server /app/.build/backend-overlay/server
COPY --from=backend_export /server/BUILD_SHA /app/.build/backend-overlay/server/BUILD_SHA
COPY --from=backend_export \
  /app-path-routes-manifest.json \
  /app/.build/backend-overlay/app-path-routes-manifest.json
COPY --from=backend_export /routes-manifest.json /app/.build/backend-overlay/routes-manifest.json

# Resolve the chosen source through FROM, where Dockerfile ARG expansion is
# supported consistently; the following COPY instructions stay static.
FROM ${BACKEND_ARTIFACT_STAGE} AS selected-backend

# Merge in a temporary stage so the final stage can inherit the official
# runtime configuration (user, environment, entrypoint, and command) unchanged.
FROM ${OFFICIAL_IMAGE} AS merged-backend
USER root
ARG OMNIROUTE_BUILD_SHA

COPY --from=selected-backend --chown=node:node \
  /app/.build/backend-overlay/server \
  /app/.build/next/omni-overlay/server
COPY scripts/build/write-build-sha.mjs /app/scripts/build/write-build-sha.mjs
# AICODE-NOTE: This gate covers both compiled and prebuilt selected server trees.
RUN OMNIROUTE_BUILD_SHA="$OMNIROUTE_BUILD_SHA" NEXT_DIST_DIR=.build/next/omni-overlay \
  node scripts/build/write-build-sha.mjs --verify-server
COPY --from=selected-backend \
  /app/.build/backend-overlay/routes-manifest.json \
  /tmp/omni-overlay-routes-manifest.json
COPY --from=selected-backend \
  /app/.build/backend-overlay/app-path-routes-manifest.json \
  /tmp/omni-overlay-app-path-routes-manifest.json
COPY scripts/build/merge-official-backend-overlay.mjs /app/.merge-official-backend-overlay.mjs

RUN node /app/.merge-official-backend-overlay.mjs \
    --base-dist /app/.build/next \
    --overlay-server /app/.build/next/omni-overlay/server \
    --overlay-routes /tmp/omni-overlay-routes-manifest.json \
    --overlay-app-path-routes /tmp/omni-overlay-app-path-routes-manifest.json \
    --runtime-overlay-server /app/.build/next/omni-overlay/server \
  && rm -f \
    /tmp/omni-overlay-routes-manifest.json \
    /tmp/omni-overlay-app-path-routes-manifest.json \
    /app/.merge-official-backend-overlay.mjs

# The published filesystem starts from the verified official image. Replace
# its migrations with the fork set, then copy the backend subtree/manifests.
FROM ${OFFICIAL_IMAGE} AS runtime
# AICODE-NOTE: migrationRunner resolves /app/migrations before bundled source paths.
RUN rm -rf /app/migrations
COPY src/lib/db/migrations/ /app/migrations/
COPY --from=merged-backend \
  /app/.build/next/omni-overlay/server \
  /app/.build/next/omni-overlay/server
# AICODE-NOTE: The final stage starts from official again; retain the generated startup delegate.
COPY --from=merged-backend \
  /app/.build/next/server/instrumentation.js \
  /app/.build/next/server/instrumentation.js
COPY --from=merged-backend \
  /app/.build/next/server/app-paths-manifest.json \
  /app/.build/next/server/app-paths-manifest.json
COPY --from=merged-backend \
  /app/.build/next/app-path-routes-manifest.json \
  /app/.build/next/app-path-routes-manifest.json
COPY --from=merged-backend \
  /app/.build/next/server/functions-config-manifest.json \
  /app/.build/next/server/functions-config-manifest.json
COPY --from=merged-backend \
  /app/.build/next/routes-manifest.json \
  /app/.build/next/routes-manifest.json
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
