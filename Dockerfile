# A1K Task Tracker — one image, one process, one port.
#
# The API serves the built interface, so there is no second container and no
# reverse proxy inside the image. Put TLS in front of it.
#
# Two stages: the first has the compilers better-sqlite3 needs if npm cannot
# find a prebuilt binary for the platform; the second carries none of that.

# --- build -------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Dependencies first, so a code change does not reinstall the world.
COPY server/package*.json server/
RUN npm --prefix server ci --omit=dev

COPY client/package*.json client/
RUN npm --prefix client ci

COPY . .
RUN npm --prefix client run build

# --- run ---------------------------------------------------------------------
FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=4100

COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/package.json ./package.json

# The database and the attachments live here; mount it as a volume.
RUN mkdir -p server/data && chown -R node:node /app
USER node
VOLUME ["/app/server/data"]
EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
