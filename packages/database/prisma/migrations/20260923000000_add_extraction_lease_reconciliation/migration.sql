-- Expired processing leases are scanned by the reconciliation worker in bounded batches.
CREATE INDEX "Document_status_extractionLeaseExpiresAt_idx"
  ON "Document"("status", "extractionLeaseExpiresAt");
