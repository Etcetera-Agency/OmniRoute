ARG OFFICIAL_IMAGE=ghcr.io/diegosouzapw/omniroute@sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96
ARG OFFICIAL_BASE_DIGEST=sha256:754b5e50361dc2802f0b6576456e72a5163cdc991378ce3f212a2f90b771eb96
ARG BACKEND_ARTIFACT_STAGE=backend-builder

# Build the fork's API bundles against the exact Next.js and Node versions in
# the verified official image. NEXT_DIST_DIR isolates this output from its UI.
FROM ${OFFICIAL_IMAGE} AS backend-builder
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

COPY . ./

RUN mkdir -p /app/data \
  && npm run build:backend \
  && test -s /app/.build/backend-overlay/server/app-paths-manifest.json \
  && test -s /app/.build/backend-overlay/server/functions-config-manifest.json \
  && test -s /app/.build/backend-overlay/routes-manifest.json

# Adapter for a separately compiled backend export. This stage is selected
# only when BACKEND_ARTIFACT_STAGE=prebuilt-backend; BuildKit prunes the
# backend-builder stage, so packaging does not compile a second time.
FROM scratch AS prebuilt-backend
COPY --from=backend_export /server /app/.build/backend-overlay/server
COPY --from=backend_export /routes-manifest.json /app/.build/backend-overlay/routes-manifest.json

# Resolve the chosen source through FROM, where Dockerfile ARG expansion is
# supported consistently; the following COPY instructions stay static.
FROM ${BACKEND_ARTIFACT_STAGE} AS selected-backend

# Merge in a temporary stage so the final stage can inherit the official
# runtime configuration (user, environment, entrypoint, and command) unchanged.
FROM ${OFFICIAL_IMAGE} AS merged-backend
USER root

COPY --from=selected-backend --chown=node:node \
  /app/.build/backend-overlay/server \
  /app/.build/next/omni-overlay/server
COPY --from=selected-backend \
  /app/.build/backend-overlay/routes-manifest.json \
  /tmp/omni-overlay-routes-manifest.json
COPY scripts/build/merge-official-backend-overlay.mjs /tmp/merge-official-backend-overlay.mjs

RUN node /tmp/merge-official-backend-overlay.mjs \
    --base-dist /app/.build/next \
    --overlay-server /app/.build/next/omni-overlay/server \
    --overlay-routes /tmp/omni-overlay-routes-manifest.json \
    --runtime-overlay-server /app/.build/next/omni-overlay/server \
  && rm -f /tmp/omni-overlay-routes-manifest.json /tmp/merge-official-backend-overlay.mjs

# The published filesystem starts from the verified official image. Copy only
# the isolated backend subtree and the three merged routing manifests.
FROM ${OFFICIAL_IMAGE} AS runtime
COPY --from=merged-backend \
  /app/.build/next/omni-overlay/server \
  /app/.build/next/omni-overlay/server
COPY --from=merged-backend \
  /app/.build/next/server/app-paths-manifest.json \
  /app/.build/next/server/app-paths-manifest.json
COPY --from=merged-backend \
  /app/.build/next/server/functions-config-manifest.json \
  /app/.build/next/server/functions-config-manifest.json
COPY --from=merged-backend \
  /app/.build/next/routes-manifest.json \
  /app/.build/next/routes-manifest.json
