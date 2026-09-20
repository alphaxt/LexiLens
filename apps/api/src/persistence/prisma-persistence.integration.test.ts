import { createHash, randomUUID } from 'node:crypto';
import type { DocumentRecord } from '@lexilens/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPersistenceAdapter } from './prisma-persistence.adapter';

const databaseUrl = process.env.DATABASE_TEST_URL;
const ownerId = `integration:${randomUUID()}`;
const otherOwnerId = `integration:${randomUUID()}`;
const principal = { ownerId, subject: ownerId, mode: 'local' as const };
let repository: PrismaPersistenceAdapter;

function quarantined(owner: string, sourceText: string): DocumentRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ownerId: owner,
    title: 'Integration terms',
    sourceText,
    contentHash: createHash('sha256').update(sourceText).digest('hex'),
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

describe.skipIf(databaseUrl === undefined)('PrismaPersistenceAdapter PostgreSQL contract', () => {
  beforeAll(async () => {
    repository = new PrismaPersistenceAdapter(databaseUrl!);
    await repository.deleteOwner(principal);
    await repository.deleteOwner({
      ownerId: otherOwnerId,
      subject: otherOwnerId,
      mode: 'local',
    });
  });

  afterAll(async () => {
    await repository.deleteOwner(principal);
    await repository.deleteOwner({
      ownerId: otherOwnerId,
      subject: otherOwnerId,
      mode: 'local',
    });
    await repository.onModuleDestroy();
  });

  it('enforces deduplication, owner isolation, soft-delete re-upload, export, and erasure', async () => {
    const first = quarantined(ownerId, 'This membership automatically renews.');
    const competing = { ...first, id: randomUUID() };
    const reservations = await Promise.all([
      repository.reserveDocument(first),
      repository.reserveDocument(competing),
    ]);
    expect(reservations.filter((reservation) => reservation.created)).toHaveLength(1);
    expect(new Set(reservations.map((reservation) => reservation.document.id))).toHaveLength(1);

    const otherOwner = await repository.reserveDocument(
      quarantined(otherOwnerId, first.sourceText),
    );
    expect(otherOwner.created).toBe(true);
    expect(otherOwner.document.id).not.toBe(reservations[0]!.document.id);

    await repository.softDeleteDocument(ownerId, reservations[0]!.document.id);
    await expect(
      repository.reserveDocument(quarantined(ownerId, first.sourceText)),
    ).resolves.toMatchObject({
      created: true,
    });

    await repository.updatePrivacy(principal, { retentionPolicy: '30_DAYS' });
    const exported = await repository.exportAccount(principal);
    expect(exported.account.privacy.retentionPolicy).toBe('30_DAYS');
    expect(exported.securityEvents.at(-1)?.type).toBe('DATA_EXPORTED');
    expect(Object.keys(exported.securityEvents[0]!).sort()).toEqual([
      'actorMode',
      'id',
      'occurredAt',
      'type',
    ]);
    await expect(repository.health()).resolves.toMatchObject({ healthy: true });

    await expect(repository.deleteOwner(principal)).resolves.toMatchObject({
      status: 'DELETED',
      purgedDocuments: 2,
    });
    await expect(repository.listDocuments(ownerId)).resolves.toEqual([]);
    await expect(repository.listSecurityEvents(ownerId)).resolves.toEqual([]);
  });
});
