import { describe, expect, it } from 'vitest';
import { CleanupReconcilerService } from './cleanup-reconciler.service';
import { MemoryPersistenceAdapter } from './persistence/memory-persistence.adapter';
import { MemoryQuarantineStorageAdapter } from './storage/memory-quarantine-storage.adapter';
import { Readable } from 'node:stream';

const owner = 'owner-a';
async function storedDocument(
  repository: MemoryPersistenceAdapter,
  storage: MemoryQuarantineStorageAdapter,
  id = crypto.randomUUID(),
) {
  const now = new Date().toISOString();
  const key = `q-${crypto.randomUUID()}`;
  await repository.reserveDocument({
    id,
    ownerId: owner,
    title: 'Terms',
    sourceText: '',
    contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    status: 'QUARANTINED',
    storageKey: key,
    originalFilename: 'terms.txt',
    declaredMime: 'text/plain',
    detectedMime: 'text/plain',
    byteSize: 4,
    scanResult: 'CLEAN',
    rejectionCode: null,
    extractionArtifact: null,
    extractionFailure: null,
    extractionAttempts: 0,
    extractionLeaseId: null,
    extractionLeaseExpiresAt: null,
    analysis: null,
    createdAt: now,
    updatedAt: now,
  });
  await storage.put(key, Readable.from(Buffer.from('test')));
  return { id, key };
}
describe('CleanupReconcilerService', () => {
  it('keeps a requested storage document non-deleted after a failed cleanup without disclosing the key', async () => {
    const repository = new MemoryPersistenceAdapter();
    const storage = new MemoryQuarantineStorageAdapter();
    const document = await storedDocument(repository, storage);
    await repository.requestDocumentDeletion(owner, document.id);
    const failing = {
      put: storage.put.bind(storage),
      read: storage.read.bind(storage),
      delete: async (_key: string) => {
        throw new Error('unavailable');
      },
    };
    await expect(
      new CleanupReconcilerService(repository, failing).reconcile(),
    ).resolves.toMatchObject({ failed: 1, deleted: 0 });
    await expect(repository.findDocument(owner, document.id)).resolves.toBeUndefined();
    expect(storage.objects.get(document.key)).toEqual(Buffer.from('test'));
    const documents = (repository as unknown as { documents: Map<string, { status: string }> })
      .documents;
    expect(documents.get(document.id)?.status).toBe('DELETE_PENDING');
  });
});
