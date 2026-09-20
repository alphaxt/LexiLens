# Deployment threat model

| Asset / boundary   | Primary threats                                             | Required controls                                                                                                   |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Browser and OIDC   | token theft, redirect abuse, CSRF/XSS                       | PKCE/S256 SPA, exact redirects, HTTPS, CSP, short-lived tokens, issuer/audience validation                          |
| API                | broken authorization, oversized uploads, SSRF/vendor misuse | tenant authorization tests, size/type limits, private egress policy, bounded OCR/parser clients, rate limits/WAF    |
| Quarantine objects | public exposure, tampering, ransomware                      | S3 public-access block, TLS-only policy, SSE-KMS, least-privilege role/prefix access, versioning/retention decision |
| Database           | exfiltration, destructive migration, unavailable recovery   | private RDS, encryption, managed secrets, snapshots, tested restore, migration review                               |
| Queue/worker       | poison messages, duplicate work, backlog                    | DLQ, bounded retries/visibility, idempotency leases, reconciliation, queue age/depth alerts                         |
| Logs/telemetry     | PII/secret leakage                                          | allowlisted structured fields, redaction, restricted access/retention, incident evidence handling                   |
| CI/supply chain    | compromised dependency/image/action                         | frozen lockfile, audit, secret scan, immutable image digests, reviewed/pinned actions, provenance policy            |

Residual risks include unimplemented vendor scanner/OCR adapters, deployment-specific network/DNS/IAM choices, and a standalone extraction worker. They require explicit user-approved design and provisioning; none are deployed by these templates.
