# kara-api. Built from this folder:
#
#   buildah bud -t registry.simorghai.com/simorgh/kara-api:$VERSION services/kara-api
#
# Bases come through Harbor's proxy caches, as every Simorgh image does: the
# build host reaches the internet only through registry.simorghai.com.
ARG NODE_IMAGE=registry.simorghai.com/docker-proxy/library/node:20.17-bookworm-slim
ARG RUNTIME_IMAGE=registry.simorghai.com/gcr-proxy/distroless/nodejs20-debian12:nonroot

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# npm's source: a reachable mirror when registry.npmjs.org is not
# (--build-arg NPM_REGISTRY=https://…/); the lockfile's npmjs URLs follow it.
ARG NPM_REGISTRY=https://registry.npmjs.org/
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --registry="$NPM_REGISTRY" --fetch-retries=5 --fetch-timeout=60000
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM ${RUNTIME_IMAGE}
WORKDIR /app
ENV NODE_ENV=production PORT=3001 NODE_OPTIONS="--enable-source-maps"
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Prepared organisations for `cli.js seed-org` (EKC's chart, HR rule documents).
COPY seed ./seed
USER nonroot
EXPOSE 3001
CMD ["dist/main.js"]
