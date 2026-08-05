# syntax=docker/dockerfile:1

# --- Stage 1: build the React frontend -----------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# --- Stage 2: install production server dependencies ---------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# --- Stage 3: final runtime image ----------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=1337 \
    COMPOSE_DIR=/compose \
    ICONS_DIR=/icons

# tini gives us correct PID 1 signal handling for graceful shutdown.
RUN apk add --no-cache tini

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY --from=web /web/dist ./web/dist

# Icons are cached at runtime; make the dir writable and drop privileges so the
# container can run with a read-only root filesystem (mount /icons as a volume
# or tmpfs, and /compose read-only).
RUN mkdir -p /compose /icons \
    && chown -R node:node /icons

USER node
EXPOSE 1337
VOLUME ["/icons"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||1337)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/src/index.js"]
