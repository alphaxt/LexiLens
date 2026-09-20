-- Additive upload quarantine metadata. Existing text records retain their text and active hash.
ALTER TABLE "Document"
  ADD COLUMN "storageKey" VARCHAR(160),
  ADD COLUMN "originalFilename" VARCHAR(180),
  ADD COLUMN "declaredMime" VARCHAR(100),
  ADD COLUMN "detectedMime" VARCHAR(100),
  ADD COLUMN "byteSize" INTEGER,
  ADD COLUMN "scanResult" VARCHAR(20),
  ADD COLUMN "rejectionCode" VARCHAR(80);

CREATE INDEX "Document_ownerId_status_createdAt_upload_idx"
  ON "Document"("ownerId", "status", "createdAt");
