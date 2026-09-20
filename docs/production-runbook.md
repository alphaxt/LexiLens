# Production runbook

**Approval boundary:** production provisioning, DNS, IAM, OIDC tenants, keys, secrets, images, migrations, and deployment are user-owned approvals. This repository change performed **no deployment or cloud provisioning**. Compose is local development only, never a production deployment definition.

## Release and rollback

1. Build API and web images from the multi-stage Dockerfiles, scan them, and promote immutable digests only.
2. Review Terraform values, remote state, network ingress, IAM, CloudFront/WAF/ALB configuration, and a plan under change control. Apply only after approval.
3. Run `pnpm --filter @lexilens/database db:migrate` as a one-off task before shifting traffic. `/health` returns 503 until the expected migration exists.
4. Deploy API with at least two tasks, verify `/health`, authentication, uploads, queue depth, and extraction reconciliation. Roll back application images by digest; do not roll back destructive migrations without a tested restore plan.
5. Take an RDS snapshot before schema changes. Test quarterly restore to an isolated account/VPC and verify application-level reads against the restored copy.

## Identity, storage, and workers

- Register a public OIDC SPA using authorization code + PKCE/S256, no client secret. Allow only exact HTTPS production callback and logout URLs; API validates issuer, audience, JWKS, and tenant claims. Rotate signing keys according to the issuer procedure.
- Keep quarantine S3 private, block all public access, require TLS and SSE-KMS, log data events where approved, and grant task roles object-prefix/KMS access only. Do not place documents in CloudFront origins.
- Deploy an approved malware scanner before release. Configure OCR/parser vendors through secrets, enforce bounded inputs/timeouts, and record vendor version/results. The checked-in magic scanner and local text extraction are not sufficient for production.
- The template supplies SQS/DLQ only. This repo has no standalone worker. Deploy a reviewed queue consumer that invokes the extraction boundary, uses idempotency/lease semantics, alarms on DLQ age/depth, and runs periodic reconciliation. Reconcile source objects, document records, extraction status, and queue messages; quarantine or investigate mismatches.

## Observability and incidents

- Send structured logs to a restricted sink. Never log document content, authorization headers, OIDC tokens, database URLs, object keys containing personal data, or OCR payloads. Apply redaction at application and log-pipeline layers.
- Initial SLOs: 99.9% monthly API availability, `/health` failure alert within 5 minutes, p95 API latency threshold agreed per endpoint, zero unacknowledged DLQ messages beyond 15 minutes, backup job/snapshot failures alerted immediately. Tune from observed baselines.
- Incident response: declare severity, preserve minimal metadata, stop unsafe consumers, restrict affected IAM sessions, rotate compromised credentials, capture an approved snapshot/log evidence set, assess exposure, restore from known-good data if required, and complete a post-incident review.
- Rotate database, S3/OCR, and OIDC-related secrets through the secret manager; deploy consumers of the new version, verify health, then revoke the old value. Never use `.env`, Compose defaults, or Git for production secrets.
