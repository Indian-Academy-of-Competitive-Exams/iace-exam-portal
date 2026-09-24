# The API image, for ARM — Fargate runs it on Graviton. One image serves all three roles;
# API_ROLE decides what a container answers. Build from the repo root:
#   docker build -f apps/api/Dockerfile --target runtime -t iace-api .
#   docker build -f apps/api/Dockerfile --target migrate -t iace-migrate .
# Migrations are a separate target because the Prisma CLI drags in the schema engine, a second
# query engine, effect and typescript — 156MB a container serving requests never opens.

FROM node:22.23.2-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# Prisma's engines link against OpenSSL, which alpine does not ship. tini is PID 1 because Nest
# closes gracefully and then re-raises the signal to itself, which PID 1 ignores: without an init
# the container shuts down cleanly and then sits there until the orchestrator kills it.
RUN apk add --no-cache openssl tini && corepack enable
WORKDIR /repo

FROM base AS deps
# Manifests only: a source edit must not cost a reinstall.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/test/package.json apps/test/
COPY apps/mobile/package.json apps/mobile/
COPY packages/contracts/package.json packages/contracts/
COPY packages/app-kit/package.json packages/app-kit/
COPY packages/ui/package.json packages/ui/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY prisma prisma
COPY packages packages
COPY apps/api apps/api
COPY turbo.json ./
RUN pnpm db:generate && pnpm --filter @iace/api... build
# A real folder per workspace dependency, not the symlink a plain deploy leaves behind.
RUN pnpm deploy --filter @iace/api --prod --config.inject-workspace-packages=true /out
# The generated client lives inside @prisma/client, which `deploy` restores from the store.
RUN cp -r /repo/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma \
  "$(dirname /out/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma)"/
# `@prisma/client` names the CLI as an optional peer, so deploy brings it and its dependencies
# along: 140MB a container serving requests never opens. Trimmed here, not after the COPY, or
# the files would still sit in the layer underneath.
RUN rm -rf /out/node_modules/.pnpm/prisma@* /out/node_modules/.pnpm/@prisma+engines@* \
  /out/node_modules/.pnpm/effect@* /out/node_modules/.pnpm/typescript@* /out/node_modules/.bin/prisma
# The client ships a WASM engine per database for edge runtimes; this one talks to Postgres
# through the native engine beside it, so the other four are 45MB of nothing.
RUN find /out/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/runtime \
  \( -name '*cockroachdb*' -o -name '*mysql*' -o -name '*sqlserver*' -o -name '*sqlite*' \) -delete

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]

# The one-off task a release runs before the new containers start.
FROM base AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/prisma prisma
# npm rather than the workspace copy: pnpm's store layout is symlinks, which do not survive a COPY.
RUN npm install -g --no-audit --no-fund prisma@6.19.3
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"]
