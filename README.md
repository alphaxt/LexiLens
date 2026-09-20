# LexiLens

A privacy-first document-audit MVP. It identifies consumer-contract risks with evidence-linked explanations, transparent estimates, deadlines, and editable drafts. It is educational decision support—not legal, financial, or medical advice.

## Packages

- `apps/api` — NestJS/Fastify API with in-memory demo storage and a secure document lifecycle.
- `apps/web` — Next.js Document X-Ray workspace.
- `packages/contracts` — Versioned Zod contracts shared by client and server.

## Run locally

```powershell
corepack pnpm install
corepack pnpm dev
```

Open `http://localhost:3000`. The API health endpoint is at `http://localhost:4000/health`.

## Authentication

Development defaults to `AUTH_MODE=local`, where a random UUID partitions in-memory browser sessions. This is not authentication and configuration rejects non-loopback binding. Production refuses to start unless `AUTH_MODE=oidc`, `OIDC_ISSUER_URL`, `OIDC_JWKS_URI`, and `OIDC_AUDIENCE` are configured with HTTPS provider URLs. Set the JWKS URI from the provider's discovery metadata. OIDC access tokens are restricted to RS256 and validated for signature, issuer, audience, expiration, and a string subject.

The included browser UI is intentionally local-mode only. A production browser OIDC authorization-code/PKCE integration is a separate deployment feature; do not expose this UI or API publicly until that client is configured.

## Production boundaries

The demo deliberately uses text-only ingestion and in-memory storage. Production deployment must replace the storage and scan adapters with private object storage, malware scanning, native PDF/OCR adapters, background queues, authenticated OIDC identity, and the approved compliance controls described in the architecture plan.
