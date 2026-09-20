# syntax=docker/dockerfile:1.7
# Build context: repository root (docker build -f apps/web/Dockerfile .)
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
ARG NEXT_PUBLIC_API_URL=https://api.example.invalid
ARG NEXT_PUBLIC_AUTH_MODE=oidc
ARG NEXT_PUBLIC_OIDC_ISSUER=https://issuer.example.invalid/
ARG NEXT_PUBLIC_OIDC_CLIENT_ID=replace-with-approved-public-spa-client-id
ARG NEXT_PUBLIC_OIDC_REDIRECT_URI=https://app.example.invalid/auth/callback
ARG NEXT_PUBLIC_OIDC_POST_LOGOUT_URI=https://app.example.invalid/
ARG NEXT_PUBLIC_OIDC_AUDIENCE=https://api.example.invalid
ARG NEXT_PUBLIC_OIDC_SCOPE=openid profile documents:read documents:write
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AUTH_MODE=$NEXT_PUBLIC_AUTH_MODE
ENV NEXT_PUBLIC_OIDC_ISSUER=$NEXT_PUBLIC_OIDC_ISSUER
ENV NEXT_PUBLIC_OIDC_CLIENT_ID=$NEXT_PUBLIC_OIDC_CLIENT_ID
ENV NEXT_PUBLIC_OIDC_REDIRECT_URI=$NEXT_PUBLIC_OIDC_REDIRECT_URI
ENV NEXT_PUBLIC_OIDC_POST_LOGOUT_URI=$NEXT_PUBLIC_OIDC_POST_LOGOUT_URI
ENV NEXT_PUBLIC_OIDC_AUDIENCE=$NEXT_PUBLIC_OIDC_AUDIENCE
ENV NEXT_PUBLIC_OIDC_SCOPE=$NEXT_PUBLIC_OIDC_SCOPE
RUN pnpm --filter @lexilens/web... build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 10001 lexilens && useradd --system --uid 10001 --gid lexilens --home-dir /app --shell /usr/sbin/nologin lexilens
COPY --from=build --chown=lexilens:lexilens /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=lexilens:lexilens /workspace/apps/web/.next/static ./apps/web/.next/static
USER lexilens
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/web/server.js"]
