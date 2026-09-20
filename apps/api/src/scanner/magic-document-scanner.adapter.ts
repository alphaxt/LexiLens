import { Injectable } from '@nestjs/common';
import type { DocumentScannerPort, ScanResult } from './document-scanner.port';

const allowed = new Set(['text/plain', 'application/pdf', 'image/png', 'image/jpeg']);
function detectedMime(
  bytes: Buffer,
): 'text/plain' | 'application/pdf' | 'image/png' | 'image/jpeg' | undefined {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.every(
      (value) => value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126),
    )
  )
    return 'text/plain';
  return undefined;
}

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
    if (!allowed.has(input.declaredMime))
      return { outcome: 'REJECTED', code: 'UNSUPPORTED_DECLARED_MIME' };
    const detected = detectedMime(input.bytes);
    if (!detected) return { outcome: 'REJECTED', code: 'INVALID_MAGIC_BYTES' };
    if (detected !== input.declaredMime) return { outcome: 'REJECTED', code: 'MIME_MISMATCH' };
    return { outcome: 'CLEAN', detectedMime: detected };
  }
}
