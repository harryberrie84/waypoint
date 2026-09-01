# Waypoint: the SPA and the API on one port, out of one PocketBase binary.
#
# The app resolves its API base to window.location.origin, so serving the built
# frontend from PocketBase's own pb_public is what makes this need zero client
# configuration: no VITE_PB_URL, no CORS, no per-device setup. Do not split the
# frontend into a second container, that is what you would be undoing.

# --- build the frontend ------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first so a source-only change reuses this layer. npm ci installs
# from the lockfile, so the platform bindings are the image's, never the host's.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# --- runtime -----------------------------------------------------------------
# No Node here: the runtime is the PocketBase binary plus static files. The schema
# is built by the bundled migrations, so this image needs no admin login to install
# itself.
FROM alpine:3.20

# Pin the server version. This app is written against the 0.22 hook and DAO API;
# 0.23 renamed both, so do not float this.
ARG PB_VERSION=0.22.21
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q -O /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
 && unzip -q /tmp/pb.zip -d /usr/local/bin pocketbase \
 && chmod +x /usr/local/bin/pocketbase \
 && rm /tmp/pb.zip \
 && apk del unzip wget

WORKDIR /pb
COPY --from=build /app/dist            /pb/pb_public
COPY server/pb_hooks                   /pb/pb_hooks
COPY server/pb_migrations              /pb/pb_migrations
COPY docker-entrypoint.sh              /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# pb_data is the whole database. Mount a volume here or lose everything on
# `docker compose down`.
VOLUME /pb/pb_data
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
