# Simorgh Kara — the web app (kara-web) and its migration image (kara-migrate),
# built from the repository root:
#
#   buildah bud --target web     -t registry.simorghai.com/simorgh/kara-web:$VERSION .
#   buildah bud --target migrate -t registry.simorghai.com/simorgh/kara-migrate:$VERSION .
#
# kara-api has its own Dockerfile (services/kara-api). Bases come through
# Harbor's proxy caches: the build host reaches the internet only through
# registry.simorghai.com.
ARG NODE_IMAGE=registry.simorghai.com/docker-proxy/library/node:20.17-bookworm-slim
ARG RUNTIME_IMAGE=registry.simorghai.com/gcr-proxy/distroless/nodejs20-debian12:nonroot

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY next.config.js tsconfig.json tailwind.config.ts postcss.config.js next-env.d.ts ./
COPY public ./public
COPY src ./src
# src/lib/db.ts wants a URL when pages are collected; nothing connects at build.
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgres://build@localhost:5432/build
RUN npx next build

# The release Job: platform schema, first admin, tenant migrations (tsx).
FROM deps AS migrate
COPY tsconfig.json ./
COPY src/lib ./src/lib
COPY scripts ./scripts
USER node
CMD ["node", "--import", "tsx", "scripts/deploy-migrate.ts"]

FROM ${RUNTIME_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER nonroot
EXPOSE 3000
CMD ["server.js"]
