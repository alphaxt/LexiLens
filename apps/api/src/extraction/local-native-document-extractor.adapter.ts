import { Injectable } from '@nestjs/common';
import type { ExtractionArtifact } from '@lexilens/contracts';
import type { NativeDocumentExtractorPort } from './native-document-extractor.port';
import { OcrProviderError } from './ocr-provider.port';

@Injectable()
export class LocalNativeDocumentExtractorAdapter implements NativeDocumentExtractorPort {
  async extract(input: {
    mime: 'text/plain' | 'application/pdf';
    bytes: Buffer;
    maxCharacters: number;
    maxPages: number;
  }): Promise<ExtractionArtifact> {
    if (input.mime === 'application/pdf') {
      if (input.bytes.length < 8 || !input.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new OcrProviderError({
          code: 'PDF_INVALID',
          message: 'PDF header is invalid or truncated.',
          retryable: false,
          pageNumber: null,
        });
      }
      throw new OcrProviderError({
        code: 'OCR_UNAVAILABLE',
        message: 'Native PDF extraction is not bundled; OCR is unavailable.',
        retryable: false,
        pageNumber: null,
      });
    }

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
    } catch {
      throw new OcrProviderError({
        code: 'INVALID_UTF8',
        message: 'Text source is not valid UTF-8.',
        retryable: false,
        pageNumber: null,
      });
    }
    if (!text) {
      throw new OcrProviderError({
        code: 'UNSUPPORTED_DOCUMENT',
        message: 'Text source is empty.',
        retryable: false,
        pageNumber: null,
      });
    }
    if (text.length > input.maxCharacters) {
      throw new OcrProviderError({
        code: 'OUTPUT_LIMIT',
        message: 'Extracted text exceeds configured character limit.',
        retryable: false,
        pageNumber: null,
      });
    }
    return {
      canonicalText: text,
      pages: [
        {
          pageNumber: 1,
          startOffset: 0,
          endOffset: text.length,
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
    };
  }
}
