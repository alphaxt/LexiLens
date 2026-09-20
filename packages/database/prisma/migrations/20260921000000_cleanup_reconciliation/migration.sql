-- Durable object-deletion intent and bounded retry state. Existing data is retained until a task completes.
CREATE TYPE "CleanupReason" AS ENUM ('USER_DELETE', 'ACCOUNT_DELETE', 'RETENTION_EXPIRED', 'REJECTED_UPLOAD');
CREATE TYPE "CleanupState" AS ENUM ('PENDING', 'LEASED', 'SUCCEEDED');

ALTER TABLE "Document" ADD COLUMN "retentionExpiresAt" TIMESTAMP(3);

CREATE TABLE "StorageCleanupTask" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ownerId" TEXT NOT NULL,
  "documentId" UUID,
  "objectKey" VARCHAR(160) NOT NULL,
  "reason" "CleanupReason" NOT NULL,
  "state" "CleanupState" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseId" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageCleanupTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StorageCleanupTask_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StorageCleanupTask_documentId_objectKey_reason_key" ON "StorageCleanupTask"("documentId", "objectKey", "reason");
CREATE INDEX "StorageCleanupTask_state_nextAttemptAt_idx" ON "StorageCleanupTask"("state", "nextAttemptAt");
CREATE INDEX "StorageCleanupTask_ownerId_state_idx" ON "StorageCleanupTask"("ownerId", "state");
ALTER TABLE "Account" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);
ALTER TYPE "DocumentStatus" ADD VALUE 'DELETE_PENDING';
