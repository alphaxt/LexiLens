ALTER TABLE "Document" ADD COLUMN "extractionArtifact" JSONB, ADD COLUMN "extractionFailure" JSONB, ADD COLUMN "extractionAttempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "extractionLeaseId" UUID, ADD COLUMN "extractionLeaseExpiresAt" TIMESTAMP(3);
CREATE INDEX "Document_status_extractionLeaseExpiresAt_idx" ON "Document"("status", "extractionLeaseExpiresAt");
