import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { DocumentRecord, ExtractionArtifact } from '@lexilens/contracts';
import { describe, expect, it, vi } from 'vitest';
import { LocalNativeDocumentExtractorAdapter } from './extraction/local-native-document-extractor.adapter';
import type { OcrProviderPort } from './extraction/ocr-provider.port';
import { ExtractionService } from './extraction.service';
import { MemoryPersistenceAdapter } from './persistence/memory-persistence.adapter';
import { MemoryQuarantineStorageAdapter } from './storage/memory-quarantine-storage.adapter';

function readyImage(): DocumentRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ownerId: 'owner-a',
    title: 'Membership terms',
    sourceText: '',
    contentHash: 'b'.repeat(64),
    status: 'READY_FOR_EXTRACTION',
    createdAt: now,
    updatedAt: now,
    analysis: null,
    originalFilename: 'terms.png',
    declaredMime: 'image/png',
    detectedMime: 'image/png',
    byteSize: 4,
    scanResult: 'CLEAN',
    rejectionCode: null,
    storageKey: 'q-image',
    extractionArtifact: null,
    extractionFailure: null,
    extractionAttempts: 0,
    extractionLeaseId: null,
    extractionLeaseExpiresAt: null,
  };
}

const completeText = 'This consumer membership automatically renews.';
const completeArtifact: ExtractionArtifact = {
  canonicalText: completeText,
  pages: [
    {
      pageNumber: 1,
      startOffset: 0,
      endOffset: completeText.length,
      method: 'ocr',
      provider: 'fake',
      providerVersion: '1',
      confidence: 1,
      warnings: [],
    },
  ],
  provider: 'fake',
  providerVersion: '1',
  warnings: [],
  failures: [],
  complete: true,
};

describe('extraction provider boundary', () => {
  it('maps malformed UTF-8 to INVALID_UTF8 without decoder details', async () => {
    const native = new LocalNativeDocumentExtractorAdapter();
    await expect(
      native.extract({
        mime: 'text/plain',
        bytes: Buffer.from([0xc3, 0x28]),
        maxCharacters: 1_000,
        maxPages: 1,
      }),
    ).rejects.toMatchObject({
      failure: { code: 'INVALID_UTF8', message: 'Text source is not valid UTF-8.' },
    });
  });

  it('uses an injected OCR provider and persists only a validated canonical artifact', async () => {
    const persistence = new MemoryPersistenceAdapter();
    const storage = new MemoryQuarantineStorageAdapter();
    const document = readyImage();
    await persistence.reserveDocument(document);
    await storage.put('q-image', Readable.from([Buffer.from('fake')]));
    const provider: OcrProviderPort = { extract: vi.fn().mockResolvedValue(completeArtifact) };
    const service = new ExtractionService(
      persistence,
      storage,
      new LocalNativeDocumentExtractorAdapter(),
      provider,
    );

    await expect(service.process('owner-a', document.id)).resolves.toMatchObject({
      status: 'COMPLETED',
    });
    expect(provider.extract).toHaveBeenCalledOnce();
  });

  it('rejects invalid provider page offsets with a safe typed failure', async () => {
    const persistence = new MemoryPersistenceAdapter();
    const storage = new MemoryQuarantineStorageAdapter();
    const document = readyImage();
    await persistence.reserveDocument(document);
    await storage.put('q-image', Readable.from([Buffer.from('fake')]));
    const provider: OcrProviderPort = {
      extract: vi.fn().mockResolvedValue({
        ...completeArtifact,
        pages: [{ ...completeArtifact.pages[0]!, endOffset: 4 }],
      }),
    };
    const service = new ExtractionService(
      persistence,
      storage,
      new LocalNativeDocumentExtractorAdapter(),
      provider,
    );

    await expect(service.process('owner-a', document.id)).resolves.toMatchObject({
      status: 'FAILED',
      extractionFailure: {
        code: 'OCR_FAILED',
        message: 'Provider offsets do not match canonical text.',
      },
    });
  });
});
