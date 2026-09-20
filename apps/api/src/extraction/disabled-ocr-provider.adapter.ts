import { Injectable } from '@nestjs/common';
import type { OcrProviderPort } from './ocr-provider.port';
import { OcrProviderError } from './ocr-provider.port';

/** Deterministic local/test provider: it never performs I/O or accepts credentials. */
@Injectable()
export class DisabledOcrProviderAdapter implements OcrProviderPort {
  async extract(): Promise<never> {
    throw new OcrProviderError({
      code: 'OCR_UNAVAILABLE',
      message: 'OCR is disabled or no approved provider adapter is installed.',
      retryable: false,
      pageNumber: null,
    });
  }
}
