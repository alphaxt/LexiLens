import { randomUUID } from 'node:crypto';
import type { DocumentRecord } from '@lexilens/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryPersistenceAdapter } from './memory-persistence.adapter';

function quarantined(ownerId: string, contentHash = 'a'.repeat(64)): DocumentRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ownerId,
    title: 'Terms',
    sourceText: 'This membership automatically renews.',
    contentHash,
    status: 'QUARANTINED',
    createdAt: now,
    updatedAt: now,
    analysis: null,
    originalFilename: null,
    declaredMime: null,
    detectedMime: null,
    byteSize: null,
    scanResult: null,
    rejectionCode: null,
    storageKey: null,
    extractionArtifact: null,
    extractionFailure: null,
    extractionAttempts: 0,
    extractionLeaseId: null,
    extractionLeaseExpiresAt: null,
  };
}

describe('MemoryPersistenceAdapter repository contract', () => {
  it('atomically reserves one active owner/hash pair', async () => {
    const repository = new MemoryPersistenceAdapter();
    const candidates = [quarantined('owner-a'), quarantined('owner-a')];
    const reservations = await Promise.all(
      candidates.map((candidate) => repository.reserveDocument(candidate)),
    );

    expect(reservations.filter((reservation) => reservation.created)).toHaveLength(1);
    expect(new Set(reservations.map((reservation) => reservation.document.id))).toHaveLength(1);
  });

  it('clears the active dedup key on soft deletion while preserving owner isolation', async () => {
    const repository = new MemoryPersistenceAdapter();
    const ownerA = quarantined('owner-a');
    const ownerB = quarantined('owner-b');
    await repository.reserveDocument(ownerA);
    await repository.reserveDocument(ownerB);
    await repository.softDeleteDocument('owner-a', ownerA.id);

    const replacement = quarantined('owner-a');
    await expect(repository.reserveDocument(replacement)).resolves.toMatchObject({ created: true });
    await expect(repository.findDocument('owner-b', ownerA.id)).resolves.toBeUndefined();
    await expect(repository.listDocuments('owner-b')).resolves.toHaveLength(1);
  });

  it('returns schema-aware readiness without exposing configuration', async () => {
    const repository = new MemoryPersistenceAdapter();
    await expect(repository.health()).resolves.toEqual({
      healthy: true,
      mode: 'memory',
      schemaVersion: '20260923000000_add_extraction_lease_reconciliation',
    });
  });
});

describe('extraction claim lifecycle', () => {
  it('allows exactly one concurrent clean ready claim and fences completion', async () => {
    const repository = new MemoryPersistenceAdapter();
    const document = quarantined('owner-a');
    document.status = 'READY_FOR_EXTRACTION';
    document.scanResult = 'CLEAN';
    document.storageKey = 'q-safe';
    await repository.reserveDocument(document);
    const [first, second] = await Promise.all([
      repository.claimReadyForExtraction('owner-a', document.id, 1_000),
      repository.claimReadyForExtraction('owner-a', document.id, 1_000),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const winner = first ?? second!;
    await expect(
      repository.claimReadyForExtraction('owner-a', document.id, 1_000),
    ).resolves.toBeUndefined();
    await expect(
      repository.completeExtraction(
        'owner-a',
        document.id,
        'wrong',
        {
          canonicalText: 'x',
          pages: [
            {
              pageNumber: 1,
              startOffset: 0,
              endOffset: 1,
              method: 'native',
              provider: 'local-native',
              providerVersion: '1',
              confidence: 1,
              warnings: [],
            },
          ],
          provider: 'local-native',
          providerVersion: '1',
          warnings: [],
          failures: [],
          complete: true,
        },
        {} as never,
      ),
    ).resolves.toBeUndefined();
    expect(winner.document.status).toBe('PROCESSING');
  });
});

describe('expired extraction lease reconciliation', () => {
  async function claimed(attempts = 0) {
    const repository = new MemoryPersistenceAdapter();
    const document = quarantined('owner-a');
    document.status = 'READY_FOR_EXTRACTION';
    document.scanResult = 'CLEAN';
    document.storageKey = 'q-safe';
    document.extractionAttempts = attempts;
    await repository.reserveDocument(document);
    const claim = await repository.claimReadyForExtraction('owner-a', document.id, 1_000);
    return { repository, document, claim: claim! };
  }

  it('atomically requeues one expired claim and rejects its late completion', async () => {
    const { repository, document, claim } = await claimed();
    const result = await repository.reconcileExpiredExtractionLeases(
      3,
      10,
      new Date(Date.now() + 2_000),
    );
    expect(result).toEqual({ requeued: 1, exhausted: 0 });
    await expect(
      repository.completeExtraction(
        'owner-a',
        document.id,
        claim.leaseId,
        {} as never,
        {} as never,
      ),
    ).resolves.toBeUndefined();
    await expect(repository.findDocument('owner-a', document.id)).resolves.toMatchObject({
      status: 'READY_FOR_EXTRACTION',
      extractionAttempts: 1,
      extractionLeaseId: null,
    });
  });

  it('does not reconcile the same claim twice during concurrent runs', async () => {
    const { repository } = await claimed();
    const results = await Promise.all([
      repository.reconcileExpiredExtractionLeases(3, 10, new Date(Date.now() + 2_000)),
      repository.reconcileExpiredExtractionLeases(3, 10, new Date(Date.now() + 2_000)),
    ]);
    expect(results.reduce((count, result) => count + result.requeued, 0)).toBe(1);
  });

  it('marks a claim failed with a structured exhaustion failure at the retry limit', async () => {
    const { repository, document } = await claimed(1);
    await expect(
      repository.reconcileExpiredExtractionLeases(2, 10, new Date(Date.now() + 2_000)),
    ).resolves.toEqual({ requeued: 0, exhausted: 1 });
    await expect(repository.findDocument('owner-a', document.id)).resolves.toMatchObject({
      status: 'FAILED',
      extractionAttempts: 2,
      extractionFailure: { code: 'EXTRACTION_TIMEOUT', retryable: false },
    });
  });
});
