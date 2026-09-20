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

Scope policy: browser OIDC requests `documents:read`, `documents:write`, `account:read`, `account:write`, and `account:delete`. Read/list/draft/calendar endpoints require `documents:read`; creation/upload/deletion/extraction require `documents:write`; account read/export/audit require `account:read`, privacy updates require `account:write`, and erasure requires `account:delete`. The only bypass is `AUTH_MODE=local` on non-production loopback hosts, enforced at configuration validation.

## Private upload quarantine

`POST /documents/uploads` accepts exactly one `file` multipart part plus a bounded `title` field. Production accepts only `text/plain` until a sandboxed PDF parser/OCR queue worker is implemented and approved. Development/test may use PDF/PNG/JPEG fixture format gates, but they are never production-clean or production-processable. The service generates opaque document and storage IDs; filenames are sanitized for display only and never control paths or object keys. Uploads enter `UPLOADING`, are stored privately, scanned by a configured malware-scanner boundary, and become `READY_FOR_EXTRACTION` only after a clean versioned verdict. Scanner errors fail closed; rejected storage is deleted before a rejection is reported.

Production startup fails closed unless PostgreSQL/OIDC and `STORAGE_MODE=s3`, private HTTPS S3 endpoint credentials, and explicit `SCANNER_MODE` are configured. The bundled `magic` scanner is a format gate, **not malware protection**; deployment still requires an approved malware scanner, asynchronous extraction/OCR worker, retryable deletion reconciliation, encryption/KMS, and private bucket policy validation against the actual provider. Local/test storage is memory-only and loopback local identity remains development-only.

## Production boundaries

The demo deliberately uses text-only ingestion and in-memory storage. Production deployment must replace the storage and scan adapters with private object storage, malware scanning, native PDF/OCR adapters, background queues, authenticated OIDC identity, and the approved compliance controls described in the architecture plan.

## Extraction worker boundary

Uploads are intentionally asynchronous: a clean upload stops at `READY_FOR_EXTRACTION`. An authenticated, owner-scoped `POST /documents/:id/extraction` request makes one atomic lease claim, reads its opaque private object only after that claim, and returns status metadata only. It never returns extracted source, artifacts, storage keys, or signed download URLs. Local/test supports strict UTF-8 `text/plain` extraction with byte/character bounds and document-global page offsets. `NativeDocumentExtractorPort` and `OcrProviderPort` are narrow injected boundaries: local/test implementations are deterministic and make no network requests. OCR defaults to disabled; `OCR_MODE=configured` fails closed unless deployment injects an HTTPS endpoint and credential, but this repository deliberately bundles no vendor adapter or credentials. PDF native parsing remains disabled and returns structured `PDF_INVALID` or `OCR_UNAVAILABLE`; no sandboxing is claimed.

A real production queue/scheduler must invoke the internal extraction worker and its bounded reconciliation service. Reconciliation atomically fences expired `PROCESSING` leases: attempts below `EXTRACTION_MAX_ATTEMPTS` return to `READY_FOR_EXTRACTION`; exhausted attempts become structured terminal failures. Completion and failure writes reject expired leases. `POST /documents/reconcile-extraction` is guarded and returns only aggregate safe counts for operational use; it is not a replacement for a deployment worker. The owner trigger remains a local/development convenience and must not be treated as a synchronous production parsing API.

Production still requires an approved malware scanner, deployment-managed queue/scheduler, private storage/KMS policy validation, and a reviewed parser/OCR adapter before enabling those capabilities.

## Browser OIDC/PKCE deployment

The web app defaults to the clearly marked loopback-only local demo flow. A production Next build fails closed unless `NEXT_PUBLIC_AUTH_MODE=oidc` plus `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_OIDC_ISSUER`, `NEXT_PUBLIC_OIDC_CLIENT_ID`, `NEXT_PUBLIC_OIDC_REDIRECT_URI`, `NEXT_PUBLIC_OIDC_POST_LOGOUT_URI`, `NEXT_PUBLIC_OIDC_AUDIENCE`, and `NEXT_PUBLIC_OIDC_SCOPE` are set. These are public configuration values; **never** publish a client secret, access token, verifier, state, nonce, or private credential as `NEXT_PUBLIC_*`.

Register a **public SPA** client at the IdP: authorization-code flow with mandatory PKCE S256, no client secret, and the exact HTTPS callback URL `https://app.example/auth/callback` and exact post-logout URL you configure. Allow only the API audience and least-privilege API scopes (for example `openid profile documents:read documents:write`); do not grant `offline_access` or refresh-token issuance. The browser stores only OIDC protocol transactions (state, nonce, and PKCE verifier) in bounded, expiring `sessionStorage`; access tokens and identity state remain in memory and expiry requires reauthentication.

This deployment uses direct browser bearer calls, not a BFF. Configure the API's exact `CORS_ORIGIN` to the web origin and allow `Authorization` and `Content-Type` request headers without wildcards or credentialed cross-origin cookies. Review the generated CSP `connect-src` against the selected API and IdP domains before deployment. A same-site BFF/token-mediation design is a recommended future hardening measure, but is not included here.
