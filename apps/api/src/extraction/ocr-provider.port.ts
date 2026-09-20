import type { ExtractionArtifact, ExtractionFailure } from '@lexilens/contracts';

export const OCR_PROVIDER_PORT = Symbol('OCR_PROVIDER_PORT');

export class OcrProviderError extends Error {
  constructor(
    readonly failure: Pick<ExtractionFailure, 'code' | 'message' | 'retryable' | 'pageNumber'>,
  ) {
    super(failure.message);
  }
}

/** Provider boundary. Implementations must never expose provider response bodies or credentials. */
export interface OcrProviderPort {
  extract(input: {
    mime: 'application/pdf' | 'image/png' | 'image/jpeg';
    bytes: Buffer;
    maxCharacters: number;
    maxPages: number;
  }): Promise<ExtractionArtifact>;
}
