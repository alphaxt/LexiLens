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
      schemaVersion: '20260922000000_add_extraction_worker',
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
