# Immutable image policy

CI runs `pnpm security:image-digests` before any release image build. Dockerfiles accept only the required `NODE_IMAGE` build argument—there is no mutable release default. Compose accepts only required `POSTGRES_IMAGE`, `MINIO_IMAGE`, and `MINIO_MC_IMAGE` variables, each of which must be supplied as a complete `@sha256:<64-hex>` reference. Terraform also requires immutable API and scanner image digests.

For local Compose validation, provide safe placeholder values that have the digest form; they do not authenticate or deploy anything. For local-only experimentation, an untracked `compose.override.yaml` may use explicit mutable development images and `LEXILENS_ALLOW_MUTABLE_DEV_IMAGES=1` may bypass the policy locally. The override and bypass are absent from release CI and never weaken Terraform inputs or CI release builds.
