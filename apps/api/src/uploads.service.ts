import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DocumentMetadata, DocumentRecord } from '@lexilens/contracts';
import { DOCUMENT_SCANNER_PORT, type DocumentScannerPort } from './scanner/document-scanner.port';
import {
  QUARANTINE_STORAGE_PORT,
  type QuarantineStoragePort,
} from './storage/quarantine-storage.port';
import { Readable } from 'node:stream';
import { loadConfig } from './config';
import { PERSISTENCE_PORT, type PersistencePort } from './persistence/persistence.port';

const allowedMime = new Set(['text/plain', 'application/pdf', 'image/png', 'image/jpeg']);
function safeFilename(name: string): string {
  return (
    name
      .replace(/[\\/\0]/g, '_')
      .replace(/[^\w. -]/g, '_')
      .slice(0, 180) || 'upload'
  );
}
function clientMetadata(record: DocumentRecord): DocumentMetadata {
  const {
    ownerId: _owner,
    sourceText: _text,
    contentHash: _hash,
    storageKey: _key,
    ...metadata
  } = record;
  return metadata;
}

@Injectable()
export class UploadService {
  private readonly config = loadConfig();
  constructor(
    @Inject(PERSISTENCE_PORT) private readonly persistence: PersistencePort,
    @Inject(QUARANTINE_STORAGE_PORT) private readonly storage: QuarantineStoragePort,
    @Inject(DOCUMENT_SCANNER_PORT) private readonly scanner: DocumentScannerPort,
  ) {}

  async upload(
    ownerId: string,
    input: {
      title: string;
      filename: string;
      mimeType: string;
      stream: AsyncIterable<Buffer | string>;
    },
  ): Promise<DocumentMetadata> {
    if (!allowedMime.has(input.mimeType))
      throw new BadRequestException('Unsupported file MIME type.');
    const chunks: Buffer[] = [];
    let size = 0;
    const hash = createHash('sha256');
    for await (const chunk of input.stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > this.config.MAX_UPLOAD_BYTES)
        throw new BadRequestException('Upload exceeds the configured byte limit.');
      hash.update(bytes);
      chunks.push(bytes);
    }
    if (!size) throw new BadRequestException('Empty uploads are not allowed.');
    const now = new Date().toISOString();
    const id = randomUUID();
    const key = `q-${randomUUID()}`;
    const record: DocumentRecord = {
      id,
      ownerId,
      title: input.title.trim(),
      sourceText: '',
      contentHash: hash.digest('hex'),
      status: 'UPLOADING',
      originalFilename: safeFilename(input.filename),
      declaredMime: input.mimeType as DocumentRecord['declaredMime'],
      detectedMime: null,
      byteSize: size,
      scanResult: 'PENDING',
      rejectionCode: null,
      storageKey: key,
      createdAt: now,
      updatedAt: now,
      analysis: null,
    };
    const reservation = await this.persistence.reserveDocument(record);
    if (!reservation.created) return clientMetadata(reservation.document);
    const bytes = Buffer.concat(chunks);
    try {
      await this.storage.put(key, Readable.from(bytes));
      await this.persistence.transitionDocument(ownerId, id, 'QUARANTINED', null);
    } catch {
      await this.storage.delete(key).catch(() => undefined);
      await this.persistence.transitionDocument(ownerId, id, 'REJECTED', null);
      await this.persistence.updateUploadMetadata(ownerId, id, {
        detectedMime: null,
        scanResult: 'ERROR',
        rejectionCode: 'SCANNER_ERROR',
      });
      throw new ServiceUnavailableException('Upload storage is temporarily unavailable.');
    }
    const result = await this.scanner
      .scan({ declaredMime: input.mimeType, bytes, maxBytes: this.config.MAX_UPLOAD_BYTES })
      .catch(() => ({ outcome: 'ERROR' as const, code: 'SCANNER_ERROR' }));
    if (result.outcome === 'CLEAN') {
      const clean = await this.persistence.transitionDocument(
        ownerId,
        id,
        'READY_FOR_EXTRACTION',
        null,
      );
      const updated = await this.persistence.updateUploadMetadata(ownerId, id, {
        detectedMime: result.detectedMime,
        scanResult: 'CLEAN',
        rejectionCode: null,
      });
      return clientMetadata(updated ?? clean!);
    }
    const rejected = await this.persistence.transitionDocument(ownerId, id, 'REJECTED', null);
    const updated = await this.persistence.updateUploadMetadata(ownerId, id, {
      detectedMime: null,
      scanResult: result.outcome,
      rejectionCode: result.code as DocumentRecord['rejectionCode'],
    });
    return clientMetadata(updated ?? rejected!);
  }

  async metadata(ownerId: string, id: string): Promise<DocumentMetadata | undefined> {
    const record = await this.persistence.findDocument(ownerId, id);
    return record ? clientMetadata(record) : undefined;
  }
}
