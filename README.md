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

## Private upload quarantine

`POST /documents/uploads` accepts exactly one `file` multipart part plus a bounded `title` field. The supported declared and independently detected formats are `text/plain`, `application/pdf`, `image/png`, and `image/jpeg`. The service generates opaque document and storage IDs; filenames are sanitized for display only and never control paths or object keys. Uploads enter `UPLOADING`, are stored privately, scanned for magic bytes, and become `READY_FOR_EXTRACTION` only after a clean result. Rejected or scanner-error uploads never enter audit/extraction and have no content/download endpoint.

Production startup fails closed unless PostgreSQL/OIDC and `STORAGE_MODE=s3`, private HTTPS S3 endpoint credentials, and explicit `SCANNER_MODE` are configured. The bundled `magic` scanner is a format gate, **not malware protection**; deployment still requires an approved malware scanner, asynchronous extraction/OCR worker, retryable deletion reconciliation, encryption/KMS, and private bucket policy validation against the actual provider. Local/test storage is memory-only and loopback local identity remains development-only.

## Production boundaries

The demo deliberately uses text-only ingestion and in-memory storage. Production deployment must replace the storage and scan adapters with private object storage, malware scanning, native PDF/OCR adapters, background queues, authenticated OIDC identity, and the approved compliance controls described in the architecture plan.
