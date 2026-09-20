# Guarded private-workload Terraform template

This directory is an **unprovisioned private-workload template**. It intentionally has no backend configuration and this repository does not run `init`, `plan`, or `apply`. Every managed resource depends on `acknowledge_deployment=true`; leaving it `false` prevents a reviewed deployment from proceeding.

It creates a KMS-encrypted quarantine bucket with TLS-only access, private encrypted RDS, extraction SQS and DLQ with a DLQ alarm, ECS API/scanner services, separate execution/API/worker/scanner/EventBridge roles, task secret injection, and an EventBridge-triggered one-shot maintenance worker. The worker command is `node apps/api/dist/worker.js`; it creates no HTTP listener and reconciles retention cleanup and expired extraction leases once.

## Explicit boundary

This template deliberately does **not** configure an ALB, TLS listener/certificate attachment, WAF association, public DNS, CDN, or web delivery. It exposes no API security-group ingress, so the API is unreachable until an operator-approved private ingress/edge module is added and reviewed. `scanner_endpoint` is an operator-provided approved HTTPS facade endpoint; the scanner task is a workload placement/configuration template, not automatic scanner routing or service discovery. See `docs/scanner-deployment.md`.

Before an approved deployment, configure remote state and locking; connect ingress, TLS, WAF, DNS, and web delivery in a separately reviewed module; verify private subnet egress, RDS backup/restore and alert delivery; populate an ignored `terraform.tfvars` with immutable image digests; review the resulting plan; and explicitly acknowledge deployment. No real credentials belong in example files or source control.
