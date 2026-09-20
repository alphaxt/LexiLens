# syntax=docker/dockerfile:1.7
# Build context: repository root (docker build -f apps/api/Dockerfile .)
# Required at build time: an approved immutable Node base image, e.g. node@sha256:<64 hex>.
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
RUN pnpm --filter @lexilens/api... build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 10001 lexilens && useradd --system --uid 10001 --gid lexilens --home-dir /app --shell /usr/sbin/nologin lexilens
COPY --from=build --chown=lexilens:lexilens /workspace/node_modules ./node_modules
COPY --from=build --chown=lexilens:lexilens /workspace/apps/api ./apps/api
COPY --from=build --chown=lexilens:lexilens /workspace/packages/contracts ./packages/contracts
COPY --from=build --chown=lexilens:lexilens /workspace/packages/database ./packages/database
USER lexilens
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
