import { Injectable } from '@nestjs/common';
import type { DocumentScannerPort, ScanResult } from './document-scanner.port';
/** Development/test-only byte-format validation; this is not malware scanning. */
@Injectable()
export class MagicDocumentScannerAdapter implements DocumentScannerPort {
  async scan(input: {
    declaredMime: string;
    bytes: Buffer;
    maxBytes: number;
  }): Promise<ScanResult> {
    if (!input.bytes.length) return { outcome: 'REJECTED', code: 'EMPTY_CONTENT' };
    if (input.bytes.length > input.maxBytes)
      return { outcome: 'REJECTED', code: 'OVERSIZED_CONTENT' };
    if (input.declaredMime !== 'text/plain')
      return { outcome: 'REJECTED', code: 'UNSUPPORTED_DECLARED_MIME' };
    const text = input.bytes.every(
      (value) => value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126),
    );
    return text
      ? { outcome: 'CLEAN', detectedMime: 'text/plain' }
      : { outcome: 'REJECTED', code: 'INVALID_TEXT_CONTENT' };
  }
}
