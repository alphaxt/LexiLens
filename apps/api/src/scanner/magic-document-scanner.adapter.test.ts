import { describe, expect, it } from 'vitest';
import { MagicDocumentScannerAdapter } from './magic-document-scanner.adapter';
const scanner = new MagicDocumentScannerAdapter();
describe('MagicDocumentScannerAdapter', () => {
  it('accepts bounded ASCII text only as a development/test format gate', async () => {
    await expect(
      scanner.scan({ declaredMime: 'text/plain', bytes: Buffer.from('plain text'), maxBytes: 100 }),
    ).resolves.toEqual({ outcome: 'CLEAN', detectedMime: 'text/plain' });
  });
  it.each([
    ['application/pdf', Buffer.from('%PDF-1.7'), 'UNSUPPORTED_DECLARED_MIME'],
    ['image/png', Buffer.from([0x89, 0x50]), 'UNSUPPORTED_DECLARED_MIME'],
    ['text/plain', Buffer.alloc(0), 'EMPTY_CONTENT'],
    ['text/plain', Buffer.alloc(101, 1), 'OVERSIZED_CONTENT'],
    ['text/plain', Buffer.from([0xff, 0xd8]), 'INVALID_TEXT_CONTENT'],
  ])('rejects %s or invalid input', async (declaredMime, bytes, code) => {
    await expect(scanner.scan({ declaredMime, bytes, maxBytes: 100 })).resolves.toEqual({
      outcome: 'REJECTED',
      code,
    });
  });
});
