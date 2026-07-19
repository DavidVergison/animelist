# syntax=docker/dockerfile:1

# --- build stage --------------------------------------------------------
# node:sqlite requires Node 26+; it's a built-in C++ addon (no native compilation),
# so this same base image works unmodified across architectures (README §2).
FROM node:26-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

COPY shared shared
COPY backend backend
COPY frontend frontend

RUN npm run typecheck
RUN npm run build --workspace=frontend

# --- runtime stage -------------------------------------------------------
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev

COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist

# The SQLite file lives in a mounted volume, never in the image (README §12). Owning
# /data as `node` here means Docker copies that ownership onto the named volume the
# first time it's created empty (documented Docker volume-initialization behavior) —
# without this, a fresh volume would be root-owned and unwritable by the non-root user.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

EXPOSE 8080
USER node

# Uses Node itself rather than curl/wget — alpine's node image ships neither, and
# adding one just for this would be an extra package purely for a healthcheck.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:8080/api/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "backend/dist/index.js"]
