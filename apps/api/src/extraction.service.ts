import { Inject, Injectable } from '@nestjs/common';
import type { ExtractionArtifact, ExtractionFailure } from '@lexilens/contracts';
import { PERSISTENCE_PORT, type PersistencePort } from './persistence/persistence.port';
import {
  QUARANTINE_STORAGE_PORT,
  type QuarantineStoragePort,
} from './storage/quarantine-storage.port';
import { loadConfig } from './config';
import { auditConsumerDocument, detectDomain } from './services/audit-engine';

function failure(
  code: ExtractionFailure['code'],
  message: string,
  retryable = false,
): ExtractionFailure {
  return { code, message, retryable, occurredAt: new Date().toISOString(), pageNumber: null };
}
function localArtifact(
  text: string,
  method: 'native' | 'ocr' = 'native',
  warning?: string,
): ExtractionArtifact {
  return {
    canonicalText: text,
    pages: [
      {
        pageNumber: 1,
        startOffset: 0,
        endOffset: text.length,
        method,
        provider: 'local-native',
        providerVersion: '1',
        confidence: method === 'native' ? 1 : null,
        warnings: warning ? [warning] : [],
      },
    ],
    provider: 'local-native',
    providerVersion: '1',
    warnings: warning ? [warning] : [],
    failures: [],
    complete: true,
  };
}
/** No networked provider is implemented. OCR stays disabled by default and fails closed. */
@Injectable()
export class ExtractionService {
  private readonly config = loadConfig();
  constructor(
    @Inject(PERSISTENCE_PORT) private readonly persistence: PersistencePort,
    @Inject(QUARANTINE_STORAGE_PORT) private readonly storage: QuarantineStoragePort,
  ) {}
  async process(ownerId: string, id: string) {
    const claim = await this.persistence.claimReadyForExtraction(
      ownerId,
      id,
      this.config.EXTRACTION_LEASE_MS,
    );
    if (!claim) return undefined;
    let artifact: ExtractionArtifact | null = null;
    try {
      if (!claim.document.storageKey)
        throw failure('STORAGE_MISSING', 'No quarantined source is available.', false);
      const bytes = await this.storage.read(
        claim.document.storageKey,
        this.config.MAX_UPLOAD_BYTES,
      );
      artifact = this.extract(claim.document.detectedMime ?? claim.document.declaredMime, bytes);
      if (!artifact.complete)
        throw failure('PARTIAL_EXTRACTION', 'Extraction was not complete.', false);
      const domain = detectDomain(artifact.canonicalText);
      if (domain !== 'CONSUMER')
        throw failure('UNSUPPORTED_DOCUMENT', 'Only consumer-document audit is enabled.', false);
      const analysis = auditConsumerDocument(claim.document.title, artifact.canonicalText);
      return await this.persistence.completeExtraction(
        ownerId,
        id,
        claim.leaseId,
        artifact,
        analysis,
      );
    } catch (error) {
      const structured = this.asFailure(error);
      const partial = artifact
        ? { ...artifact, complete: false, failures: [...artifact.failures, structured] }
        : null;
      return await this.persistence.failExtraction(ownerId, id, claim.leaseId, partial, structured);
    }
  }
  private extract(mime: string | null, bytes: Buffer): ExtractionArtifact {
    if (mime === 'text/plain') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!text) throw failure('UNSUPPORTED_DOCUMENT', 'Text source is empty.');
      if (text.length > this.config.EXTRACTION_MAX_CHARACTERS)
        throw failure('OUTPUT_LIMIT', 'Extracted text exceeds configured character limit.');
      return localArtifact(text);
    }
    if (mime === 'application/pdf') {
      if (bytes.length < 8 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
        throw failure('PDF_INVALID', 'PDF header is invalid or truncated.');
      throw failure(
        'OCR_UNAVAILABLE',
        'PDF native extraction is isolated pending a pinned parser; OCR is disabled.',
      );
    }
    if (mime === 'image/png' || mime === 'image/jpeg')
      throw failure('OCR_UNAVAILABLE', 'OCR is disabled in local and test environments.');
    throw failure('UNSUPPORTED_DOCUMENT', 'The scanned document type cannot be extracted.');
  }
  private asFailure(error: unknown): ExtractionFailure {
    if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error)
      return error as ExtractionFailure;
    return failure('STORAGE_UNAVAILABLE', 'Private source could not be read.', true);
  }
}
