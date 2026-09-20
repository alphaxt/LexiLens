# Production deployment checklist

No item below authorizes an automatic deployment. All infrastructure provisioning requires user approval.

- [ ] Approved account, region, remote Terraform state/locking, VPC/private subnets, egress, and restrictive security groups.
- [ ] Reviewed Terraform TODOs; immutable approved API/web image digests; separate ECS execution/task roles; no wildcard production permissions.
- [ ] RDS private/encrypted, 35-day backup policy reviewed, pre-migration snapshot taken, and restore exercise current.
- [ ] S3 quarantine bucket private, public access blocked, TLS-only/KMS policy validated, and version-aware cleanup has erased all object versions/delete markers in a non-production exercise; audit events are configured appropriately.
- [ ] OIDC SPA registration uses PKCE/S256, exact HTTPS redirect/logout URLs, correct issuer/audience/scopes, no client secret, and API JWKS validation tested.
- [ ] Approved malware scanner, OCR/parser adapter, queue consumer, DLQ alerts, idempotency, retry limit, and extraction reconciliation schedule are deployed.
- [ ] Secrets injected only at runtime from an approved manager; rotation owner/test cadence defined; no secrets in images, task definitions, Terraform variables, or logs.
- [ ] Internal API/scanner ALB TLS certificates, target health, constrained CIDRs/security groups, private DNS, WAF policy/observability, CSP/CORS, and client certificate trust are peer reviewed. This template does not provide public CloudFront/web delivery.
- [ ] Logs redact PII and credentials; dashboards and alerts cover SLOs, health, database capacity/backups, task failures, queue age/depth, DLQ, and security events.
- [ ] Migration completed and `/health`, authentication, upload, quarantine, extraction, and reconciliation smoke tests pass.
- [ ] Rollback image digest, data restore decision tree, incident contacts, and change record are approved.
