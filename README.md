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

## Production boundaries

The demo deliberately uses text-only ingestion and in-memory storage. Production deployment must replace the storage and scan adapters with private object storage, malware scanning, native PDF/OCR adapters, background queues, authenticated OIDC identity, and the approved compliance controls described in the architecture plan.
