# Guarded private-workload Terraform template

This directory is an **unprovisioned private-workload template**. It intentionally has no backend configuration and this repository does not run `init`, `plan`, or `apply`. Every managed resource depends on `acknowledge_deployment=true`; leaving it `false` prevents a reviewed deployment from proceeding.

It creates a KMS-encrypted, versioned quarantine bucket with TLS-only access; private encrypted RDS; extraction SQS/DLQ and alarm; ECS API/scanner services; separate execution/API/worker/scanner/EventBridge roles; task secret injection; and an EventBridge-triggered one-shot maintenance worker. The worker command is `node apps/api/dist/worker.js`; it creates no HTTP listener and reconciles retention cleanup and expired extraction leases once. During cleanup, the worker lists and deletes every S3 object version and delete marker before its durable database cleanup task can succeed.

## Private API and scanner edge

The template creates **internal** Application Load Balancers only—there is no public ALB, public Route 53 record, CDN, or CloudFront configuration. `api_allowed_cidrs` is required and is the only API-ALB HTTPS ingress. The API task security group allows port 4000 only from that ALB. The API ALB terminates TLS with required `api_acm_certificate_arn`, forwards to the API target group, is associated with required regional `api_waf_web_acl_arn`, and publishes `api_private_dns_name` through required `private_hosted_zone_id`.

The scanner receives an independent internal HTTPS ALB, target group, health check, required `scanner_acm_certificate_arn`, and `scanner_private_dns_name` private Route 53 record. Its ALB accepts traffic only from API and maintenance-worker security groups; the scanner task accepts port 443 only from its ALB. `SCANNER_ENDPOINT` is derived from the Terraform scanner record as `https://<scanner-private-dns>/scan`, so configured API/worker scanning cannot drift to an unrelated operator input. Both records and certificates must be valid and private clients must trust the certificate chain.

Required inputs include private subnets, approved API client CIDRs, a private hosted-zone ID, API/scanner private DNS names, regional ACM certificate ARNs, a regional API WAF ACL ARN, immutable image digests, OIDC configuration, scanner version, and an alert address. The `private_api_endpoint` and `private_scanner_endpoint` outputs identify the resulting internal endpoints; they do not imply public delivery.

Before an approved deployment, configure remote state and locking; verify VPC/private-subnet egress and DNS resolution; review certificate trust, WAF policy, CIDR scope, RDS backup/restore, and alert delivery; populate an ignored `terraform.tfvars` with immutable image digests; review the resulting plan; and explicitly acknowledge deployment. No real credentials belong in example files or source control.
