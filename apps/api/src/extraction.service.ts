import { Inject, Injectable } from '@nestjs/common';
import {
  extractionArtifactSchema,
  type ExtractionArtifact,
  type ExtractionFailure,
} from '@lexilens/contracts';
import { loadConfig } from './config';
import {
  NATIVE_DOCUMENT_EXTRACTOR_PORT,
  type NativeDocumentExtractorPort,
} from './extraction/native-document-extractor.port';
import {
  OcrProviderError,
  OCR_PROVIDER_PORT,
  type OcrProviderPort,
} from './extraction/ocr-provider.port';
import { PERSISTENCE_PORT, type PersistencePort } from './persistence/persistence.port';
import { auditConsumerDocument, detectDomain } from './services/audit-engine';
import {
  QUARANTINE_STORAGE_PORT,
  type QuarantineStoragePort,
} from './storage/quarantine-storage.port';

function failure(
  code: ExtractionFailure['code'],
  message: string,
  retryable = false,
): ExtractionFailure {
  return { code, message, retryable, occurredAt: new Date().toISOString(), pageNumber: null };
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_resolve, reject) =>
      setTimeout(
        () => reject(failure('EXTRACTION_TIMEOUT', 'Extraction exceeded its time limit.', true)),
        timeoutMs,
      ),
    ),
  ]);
}

/** Coordinates one already-claimed private upload; provider adapters are injected and never selected from input. */
@Injectable()
export class ExtractionService {
  private readonly config = loadConfig();

  constructor(
    @Inject(PERSISTENCE_PORT) private readonly persistence: PersistencePort,
    @Inject(QUARANTINE_STORAGE_PORT) private readonly storage: QuarantineStoragePort,
    @Inject(NATIVE_DOCUMENT_EXTRACTOR_PORT)
    private readonly nativeExtractor: NativeDocumentExtractorPort,
    @Inject(OCR_PROVIDER_PORT) private readonly ocrProvider: OcrProviderPort,
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
        throw failure('STORAGE_MISSING', 'No quarantined source is available.');
      const bytes = await this.storage.read(
        claim.document.storageKey,
        this.config.MAX_UPLOAD_BYTES,
      );
      artifact = await this.extract(
        claim.document.detectedMime ?? claim.document.declaredMime,
        bytes,
      );
      this.validateArtifact(artifact);
      if (!artifact.complete) throw failure('PARTIAL_EXTRACTION', 'Extraction was not complete.');
      if (detectDomain(artifact.canonicalText) !== 'CONSUMER')
        throw failure('UNSUPPORTED_DOCUMENT', 'Only consumer-document audit is enabled.');
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
      return this.persistence.failExtraction(ownerId, id, claim.leaseId, partial, structured);
    }
  }

  private async extract(mime: string | null, bytes: Buffer): Promise<ExtractionArtifact> {
    const input = {
      bytes,
      maxCharacters: this.config.EXTRACTION_MAX_CHARACTERS,
      maxPages: this.config.EXTRACTION_MAX_PAGES,
    };
    if (mime === 'text/plain' || mime === 'application/pdf')
      return withTimeout(
        this.nativeExtractor.extract({ ...input, mime }),
        this.config.EXTRACTION_TIMEOUT_MS,
      );
    if (mime === 'image/png' || mime === 'image/jpeg')
      return withTimeout(
        this.ocrProvider.extract({ ...input, mime }),
        this.config.EXTRACTION_TIMEOUT_MS,
      );
    throw failure('UNSUPPORTED_DOCUMENT', 'The scanned document type cannot be extracted.');
  }

  private validateArtifact(artifact: ExtractionArtifact): void {
    const parsed = extractionArtifactSchema.safeParse(artifact);
    if (!parsed.success)
      throw failure('OCR_FAILED', 'Provider returned an invalid extraction artifact.');
    if (artifact.canonicalText.length > this.config.EXTRACTION_MAX_CHARACTERS)
      throw failure('OUTPUT_LIMIT', 'Extracted text exceeds configured character limit.');
    if (artifact.pages.length > this.config.EXTRACTION_MAX_PAGES)
      throw failure('OUTPUT_LIMIT', 'Extracted page count exceeds configured page limit.');
    let offset = 0;
    for (let index = 0; index < artifact.pages.length; index += 1) {
      const page = artifact.pages[index]!;
      if (page.pageNumber !== index + 1 || page.startOffset !== offset || page.endOffset < offset)
        throw failure('OCR_FAILED', 'Provider returned invalid page ordering or offsets.');
      offset = page.endOffset;
    }
    if (offset !== artifact.canonicalText.length)
      throw failure('OCR_FAILED', 'Provider offsets do not match canonical text.');
  }

  private asFailure(error: unknown): ExtractionFailure {
    if (error instanceof OcrProviderError)
      return { ...error.failure, occurredAt: new Date().toISOString() };
    if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
      const candidate = error as ExtractionFailure;
      if (typeof candidate.code === 'string' && typeof candidate.message === 'string')
        return {
          ...candidate,
          occurredAt: new Date().toISOString(),
          pageNumber: candidate.pageNumber ?? null,
        };
    }
    return failure('STORAGE_UNAVAILABLE', 'Private source could not be read.', true);
  }
}
