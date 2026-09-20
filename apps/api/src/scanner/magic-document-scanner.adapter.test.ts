import { describe, expect, it } from 'vitest';
import { MagicDocumentScannerAdapter } from './magic-document-scanner.adapter';

const scanner = new MagicDocumentScannerAdapter();
describe('MagicDocumentScannerAdapter', () => {
  it.each([
    ['text/plain', Buffer.from('plain text')],
    ['application/pdf', Buffer.from('%PDF-1.7')],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xdb])],
  ] as const)('accepts %s magic bytes', async (declaredMime, bytes) => {
    await expect(scanner.scan({ declaredMime, bytes, maxBytes: 100 })).resolves.toMatchObject({
      outcome: 'CLEAN',
      detectedMime: declaredMime,
    });
  });
  it.each([
    ['text/plain', Buffer.from('%PDF-1.7'), 'MIME_MISMATCH'],
    ['application/pdf', Buffer.from('not a PDF'), 'MIME_MISMATCH'],
    ['image/png', Buffer.alloc(0), 'EMPTY_CONTENT'],
    ['image/png', Buffer.alloc(101, 1), 'OVERSIZED_CONTENT'],
    ['image/png', Buffer.from('bad bytes'), 'MIME_MISMATCH'],
  ])('rejects invalid or spoofed uploads', async (declaredMime, bytes, code) => {
    await expect(scanner.scan({ declaredMime, bytes, maxBytes: 100 })).resolves.toEqual({
      outcome: 'REJECTED',
      code,
    });
  });
});
