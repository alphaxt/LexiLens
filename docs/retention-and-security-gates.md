# Retention, deletion, and release security gates

## Durable cleanup semantics

`DELETE /documents/:id` records a durable cleanup task before any object delete. A document with an opaque stored object returns `PENDING`, not `DELETED`; it remains inaccessible to normal reads only after the reconciler has recorded successful object deletion and then clears source text, analysis, extraction artifact/failure, upload metadata, and its active deduplication key. Text-only documents can complete immediately. Cleanup operations are idempotent: tasks have leases, retry timestamps, and a stable object key retained only in the cleanup task.

Account deletion similarly returns `PENDING`. It creates tasks for every known object and deletes the account only when all tasks have succeeded. A failure keeps durable retry evidence and does not disclose keys or storage errors. `POST /documents/reconcile-cleanup` is an internal scope-gated, bounded operational boundary and returns counts only; production must schedule it and alert on failed retry age. Object listing is intentionally not granted to the API role: opaque keys are deleted individually with `s3:DeleteObject` only. Bucket inventory/lifecycle may be added as a separately approved defense-in-depth control, never as proof that application cleanup completed.

Retention uses the document creation timestamp as the explicit basis. `7_DAYS`, `30_DAYS`, and `90_DAYS` enqueue the same durable workflow after that period. `SESSION` has no server expiry: this MVP does not persist browser-session-only source data, so it must not trigger destructive server cleanup prematurely. Updating a non-session policy establishes a new expiry from the update time for currently active documents; policy changes and the basis should be reviewed before production rollout.

## Security exceptions and image release gates

`security/audit-baseline.json` is deliberately empty by default. Every exception must contain the exact policy fingerprint, a responsible owner, review reason, and an unexpired ISO timestamp. `pnpm security:audit` obtains pnpm audit JSON and fails high/critical production advisories unless exactly allowlisted; it also fails expired/incomplete exceptions. Review exceptions at least before expiry, remove them as soon as upstream remediation is available, and record approval in the change review.

CI’s `image-security-release-gate` builds both runtime images and fails closed if its scanner is absent or reports high/critical findings. The release runner must provide an approved pinned scanner before promotion; it must never use `continue-on-error`. This repository does not deploy, provision a scanner, push an image, or grant cloud access. A release owner must approve the runner/scanner installation, base image digest policy, generated scan evidence, and the immutable image digest before deployment.
