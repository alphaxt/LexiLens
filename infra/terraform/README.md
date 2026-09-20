# Terraform staged-deployment template

This directory is a **template, not a deployment**. It intentionally has no backend, account identifiers, domains, real images, credentials, or provisioned resources. `terraform.tfvars` and state are ignored. No `init`, `plan`, or `apply` was run for this change.

The template requires Terraform `>= 1.10.5, < 1.17.0` and AWS provider `5.82.2`, defines encrypted private quarantine storage, KMS, private RDS PostgreSQL with managed password, SQS/DLQ, an ECS/Fargate API task/service skeleton, logging, and least-privilege task-policy examples. It assumes an approved VPC and private subnets. CloudFront/WAF/ALB are deliberate TODOs because their origins, TLS certificate, and domain names must be user-approved.

Before a user-approved deployment: create reviewed remote state with locking, replace TODOs, create separate execution/task roles, scope security-group ingress, inject runtime values via Secrets Manager, define web/ALB/CloudFront/WAF resources, and run peer review plus an approved `terraform plan`. The API needs database migrations completed before `/health` becomes ready. A standalone worker is not in this repository; deploy a separately reviewed worker/queue consumer before using the extraction queue.
